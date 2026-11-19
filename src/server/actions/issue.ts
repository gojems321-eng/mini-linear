'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { AppError, action } from '@/lib/errors'
import {
  requireMember,
  assertUserIsWorkspaceMember,
  requireIssue,
  requireProject,
} from '@/server/rbac'
import { publish } from '@/server/realtime'
import {
  createIssueSchema,
  deleteIssueSchema,
  moveIssueSchema,
  updateIssueSchema,
} from '@/lib/validation'
import { roomForProject, STATUS_LABELS, type ActionResult, type IssueStatus } from '@/lib/types'
import type { Prisma } from '@prisma/client'
import type { IssueSyncEvent } from '@/lib/types'

const POSITION_STEP = 1024
/** Below this gap the column gets re-spaced to keep fractional ordering healthy. */
const MIN_GAP = 0.01

type TransactionClient = Prisma.TransactionClient

/**
 * Computes the insert position for `index` within the target column using
 * fractional (midpoint) ordering. If the surrounding gap has collapsed, the
 * whole column is re-spaced first inside the same transaction.
 */
async function computeInsertPosition(
  tx: TransactionClient,
  projectId: string,
  status: IssueStatus,
  index: number,
  excludeIssueId?: string,
): Promise<number> {
  const column = await tx.issue.findMany({
    where: {
      projectId,
      status,
      ...(excludeIssueId ? { id: { not: excludeIssueId } } : {}),
    },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, position: true },
  })

  const clamped = Math.max(0, Math.min(index, column.length))

  if (column.length === 0) return POSITION_STEP
  if (clamped === 0) return column[0].position - POSITION_STEP
  if (clamped >= column.length) return column[column.length - 1].position + POSITION_STEP

  const prev = column[clamped - 1].position
  const next = column[clamped].position
  if (next - prev < MIN_GAP) {
    for (let i = 0; i < column.length; i++) {
      await tx.issue.update({
        where: { id: column[i].id },
        data: { position: (i + 1) * POSITION_STEP },
      })
    }
    return (clamped + 0.5) * POSITION_STEP
  }
  return (prev + next) / 2
}

function issueEvent(
  projectId: string,
  issueId: string | null,
  reason: IssueSyncEvent['reason'],
): { rooms: string[]; event: 'issue:sync'; data: IssueSyncEvent } {
  return {
    rooms: [roomForProject(projectId)],
    event: 'issue:sync',
    data: { projectId, issueId, reason },
  }
}

export async function createIssueAction(
  input: unknown,
): Promise<ActionResult<{ issueId: string }>> {
  return action(async () => {
    const parsed = createIssueSchema.parse(input)
    const project = await requireProject(parsed.projectId)
    const actor = await requireMember(project.workspaceId)

    if (parsed.assigneeId) {
      await assertUserIsWorkspaceMember(project.workspaceId, parsed.assigneeId)
    }

    const result = await db.$transaction(async (tx) => {
      const position = await computeInsertPosition(tx, project.id, parsed.status, Number.MAX_SAFE_INTEGER)
      const issue = await tx.issue.create({
        data: {
          title: parsed.title,
          description: parsed.description ?? null,
          status: parsed.status,
          priority: parsed.priority,
          position,
          projectId: project.id,
          assigneeId: parsed.assigneeId ?? null,
          createdById: actor.userId,
        },
      })
      await tx.activity.create({
        data: {
          type: 'ISSUE_CREATED',
          message: `${actor.userName} created this issue in ${STATUS_LABELS[parsed.status]}`,
          issueId: issue.id,
          projectId: project.id,
          actorId: actor.userId,
        },
      })
      return issue
    })

    const evt = issueEvent(project.id, result.id, 'created')
    await publish(evt.rooms, evt.event, evt.data)
    revalidatePath('/')
    return { issueId: result.id }
  })
}

/**
 * Field-level update with a matching activity entry per changed field:
 * title, description, priority, status and assignee.
 */
export async function updateIssueAction(
  input: unknown,
): Promise<ActionResult<{ issueId: string }>> {
  return action(async () => {
    const parsed = updateIssueSchema.parse(input)
    const existing = await db.issue.findUnique({
      where: { id: parsed.issueId },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        assigneeId: true,
        projectId: true,
        project: { select: { id: true, workspaceId: true } },
      },
    })
    if (!existing) {
      throw new AppError('NOT_FOUND', 'Issue not found.')
    }
    const actor = await requireMember(existing.project.workspaceId)

    if (parsed.assigneeId) {
      await assertUserIsWorkspaceMember(existing.project.workspaceId, parsed.assigneeId)
    }

    const data: { title?: string; description?: string | null; priority?: string; status?: string; assigneeId?: string | null } = {}
    const activities: { type: string; message: string }[] = []

    if (parsed.title !== undefined && parsed.title !== existing.title) {
      data.title = parsed.title
      activities.push({ type: 'TITLE_UPDATED', message: `${actor.userName} updated the title` })
    }
    if (parsed.description !== undefined && parsed.description !== existing.description) {
      data.description = parsed.description
      activities.push({ type: 'DESCRIPTION_UPDATED', message: `${actor.userName} updated the description` })
    }
    if (parsed.priority !== undefined && parsed.priority !== existing.priority) {
      data.priority = parsed.priority
      activities.push({
        type: 'PRIORITY_CHANGED',
        message: `${actor.userName} set priority to ${parsed.priority.toLowerCase()}`,
      })
    }
    if (parsed.status !== undefined && parsed.status !== existing.status) {
      data.status = parsed.status
      activities.push({
        type: 'STATUS_CHANGED',
        message: `${actor.userName} moved this issue from ${STATUS_LABELS[existing.status as IssueStatus]} to ${STATUS_LABELS[parsed.status]}`,
      })
    }
    if (parsed.assigneeId !== undefined && parsed.assigneeId !== existing.assigneeId) {
      data.assigneeId = parsed.assigneeId
      if (parsed.assigneeId === null) {
        activities.push({ type: 'ASSIGNEE_CHANGED', message: `${actor.userName} unassigned this issue` })
      } else {
        const assignee = await db.user.findUnique({
          where: { id: parsed.assigneeId },
          select: { name: true },
        })
        activities.push({
          type: 'ASSIGNEE_CHANGED',
          message: `${actor.userName} assigned this issue to ${assignee?.name ?? 'a member'}`,
        })
      }
    }

    if (Object.keys(data).length === 0) {
      return { issueId: existing.id }
    }

    await db.$transaction(async (tx) => {
      await tx.issue.update({ where: { id: existing.id }, data })
      await tx.activity.createMany({
        data: activities.map((a) => ({
          type: a.type,
          message: a.message,
          issueId: existing.id,
          projectId: existing.project.id,
          actorId: actor.userId,
        })),
      })
    })

    const evt = issueEvent(existing.project.id, existing.id, 'updated')
    await publish(evt.rooms, evt.event, evt.data)
    revalidatePath('/')
    return { issueId: existing.id }
  })
}

/**
 * Drag-and-drop transition: sets the target status and splices the issue in
 * at `index` inside that column. Used by the Kanban board.
 */
export async function moveIssueAction(
  input: unknown,
): Promise<ActionResult<{ issueId: string }>> {
  return action(async () => {
    const parsed = moveIssueSchema.parse(input)
    const existing = await requireIssue(parsed.issueId)
    const actor = await requireMember(existing.project.workspaceId)

    const current = await db.issue.findUniqueOrThrow({
      where: { id: existing.id },
      select: { status: true, projectId: true },
    })

    const result = await db.$transaction(async (tx) => {
      const position = await computeInsertPosition(tx, current.projectId, parsed.status, parsed.index, existing.id)
      await tx.issue.update({
        where: { id: existing.id },
        data: { status: parsed.status, position },
      })
      if (current.status !== parsed.status) {
        await tx.activity.create({
          data: {
            type: 'STATUS_CHANGED',
            message: `${actor.userName} moved this issue from ${STATUS_LABELS[current.status as IssueStatus]} to ${STATUS_LABELS[parsed.status]}`,
            issueId: existing.id,
            projectId: current.projectId,
            actorId: actor.userId,
          },
        })
      }
      return { position }
    })

    const evt = issueEvent(current.projectId, existing.id, 'moved')
    await publish(evt.rooms, evt.event, evt.data)
    revalidatePath('/')
    return { issueId: existing.id }
  })
}

export async function deleteIssueAction(input: unknown): Promise<ActionResult<null>> {
  return action(async () => {
    const parsed = deleteIssueSchema.parse(input)
    const existing = await requireIssue(parsed.issueId)
    await requireMember(existing.project.workspaceId)

    await db.issue.delete({ where: { id: existing.id } })

    const evt = issueEvent(existing.project.id, existing.id, 'deleted')
    await publish(evt.rooms, evt.event, evt.data)
    revalidatePath('/')
    return null
  })
}
