import 'server-only'

import { tool } from 'ai'
import { z } from 'zod'
import { db } from '@/lib/db'
import { publish } from '@/server/realtime'
import { roomForProject } from '@/lib/types'
import {
  copilotCreateIssueInputSchema,
  copilotSearchIssuesInputSchema,
} from '@/lib/validations/ai'

/**
 * Agent tools for the Workspace Copilot (POST /api/ai/copilot).
 *
 * Every tool is strictly scoped to the caller's ACTIVE workspace: the route
 * authenticates the session, verifies workspace membership, and passes the
 * resolved `{ userId, workspaceId }` into `createWorkspaceTools`. Each tool
 * then RE-asserts membership against the DB (defence in depth — the closure
 * values never come from the model or the client) before reading/writing
 * Prisma. Tool inputs are Zod-validated with safeParse so the model receives
 * a structured, self-correctable error instead of an exception.
 *
 * Tool outputs are plain JSON: they travel back into the model context as
 * tool results and to the client as UIMessage tool parts.
 */

type CopilotContext = {
  userId: string
  workspaceId: string
}

const POSITION_STEP = 1024

/**
 * Re-verified per tool call. Returns the caller's display name so activity
 * entries can attribute the action to the human who asked the Copilot.
 */
async function assertMembership(context: CopilotContext): Promise<{ userName: string }> {
  const membership = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: context.workspaceId, userId: context.userId } },
    select: { id: true, user: { select: { name: true } } },
  })
  if (!membership) {
    throw new Error('FORBIDDEN: the caller is not a member of this workspace.')
  }
  return { userName: membership.user.name }
}

function truncate(text: string | null, max: number): string | null {
  if (!text) return null
  const trimmed = text.trim()
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max).trimEnd()}…`
}

/** Workspace-level overview: projects, issue counts per status, urgent work. */
function getWorkspaceSummary(context: CopilotContext) {
  return tool({
    description:
      'Get an overview of the ACTIVE workspace: its projects, how many issues sit in each status ' +
      '(BACKLOG, TODO, IN_PROGRESS, DONE) and the urgent open work. Call this first for broad ' +
      'questions about the workspace, before creating an issue (to get valid project ids), or ' +
      'when asked for a summary, status report, or workload overview. The workspace has no due ' +
      'dates — urgent open issues are the closest equivalent of "overdue".',
    inputSchema: z.object({}),
    execute: async () => {
      await assertMembership(context)

      const workspace = await db.workspace.findUnique({
        where: { id: context.workspaceId },
        select: { id: true, name: true },
      })
      if (!workspace) {
        return { exists: false, message: 'Workspace not found.' }
      }

      const [projects, statusGroups, totalIssues, urgentOpenIssues] = await Promise.all([
        db.project.findMany({
          where: { workspaceId: workspace.id },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            name: true,
            description: true,
            _count: { select: { issues: true } },
          },
        }),
        db.issue.groupBy({
          by: ['status'],
          where: { project: { workspaceId: workspace.id } },
          _count: { _all: true },
        }),
        db.issue.count({ where: { project: { workspaceId: workspace.id } } }),
        db.issue.findMany({
          where: {
            project: { workspaceId: workspace.id },
            priority: 'URGENT',
            status: { not: 'DONE' },
          },
          orderBy: [{ createdAt: 'desc' }],
          take: 8,
          select: {
            id: true,
            title: true,
            status: true,
            project: { select: { name: true } },
            assignee: { select: { name: true } },
          },
        }),
      ])

      const issueCountsByStatus = { BACKLOG: 0, TODO: 0, IN_PROGRESS: 0, DONE: 0 }
      for (const group of statusGroups) {
        issueCountsByStatus[group.status as keyof typeof issueCountsByStatus] = group._count._all
      }

      return {
        exists: true as const,
        workspace: { id: workspace.id, name: workspace.name },
        totalIssues,
        issueCountsByStatus,
        projects: projects.map((project) => ({
          id: project.id,
          name: project.name,
          description: project.description,
          issueCount: project._count.issues,
        })),
        urgentOpenIssues: urgentOpenIssues.map((issue) => ({
          id: issue.id,
          title: issue.title,
          status: issue.status,
          project: issue.project.name,
          assignee: issue.assignee?.name ?? null,
        })),
        note: 'This workspace tracks no due dates; "urgent open" lists priority-URGENT issues that are not DONE.',
      }
    },
  })
}

/** Keyword/status/priority/assignee search across the workspace's issues. */
function searchIssues(context: CopilotContext) {
  return tool({
    description:
      'Search issues in the ACTIVE workspace by keyword (title or description), status, priority, ' +
      'or assignee name. Combine filters freely; every filter is optional. Returns issue ids, ' +
      'titles, statuses, priorities, project names and assignees.',
    inputSchema: copilotSearchIssuesInputSchema,
    execute: async (rawInput) => {
      await assertMembership(context)

      const parsed = copilotSearchIssuesInputSchema.safeParse(rawInput)
      if (!parsed.success) {
        return {
          ok: false as const,
          error: `Invalid search input: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
        }
      }
      const { query, status, priority, assigneeName, limit } = parsed.data

      const where: {
        project: { workspaceId: string }
        status?: string
        priority?: string
        assigneeId?: { in: string[] }
        OR?: Array<Record<string, { contains: string }>>
      } = { project: { workspaceId: context.workspaceId } }
      if (status) where.status = status
      if (priority) where.priority = priority
      if (query) {
        where.OR = [
          { title: { contains: query } },
          { description: { contains: query } },
        ]
      }
      if (assigneeName) {
        // SQLite `contains` is case-insensitive for ASCII, so a plain LIKE
        // match on member names is enough. Restrict to users who actually
        // hold a membership in this workspace.
        const members = await db.workspaceMember.findMany({
          where: {
            workspaceId: context.workspaceId,
            user: { name: { contains: assigneeName } },
          },
          select: { userId: true },
          take: 20,
        })
        where.assigneeId = { in: members.map((member) => member.userId) }
      }

      const [totalMatches, rows] = await Promise.all([
        db.issue.count({ where }),
        db.issue.findMany({
          where,
          orderBy: [{ updatedAt: 'desc' }],
          take: limit,
          select: {
            id: true,
            title: true,
            description: true,
            status: true,
            priority: true,
            project: { select: { name: true } },
            assignee: { select: { name: true } },
            updatedAt: true,
          },
        }),
      ])

      return {
        ok: true as const,
        totalMatches,
        returned: rows.length,
        issues: rows.map((issue) => ({
          id: issue.id,
          title: issue.title,
          descriptionSnippet: truncate(issue.description, 160),
          status: issue.status,
          priority: issue.priority,
          project: issue.project.name,
          assignee: issue.assignee?.name ?? null,
          updatedAt: issue.updatedAt.toISOString(),
        })),
      }
    },
  })
}

/** Creates an issue inside the active workspace after full re-validation. */
function createIssueTool(context: CopilotContext) {
  return tool({
    description:
      'Create a new issue in a project of the ACTIVE workspace. Get a valid projectId from ' +
      'getWorkspaceSummary first unless the user provided one. Optionally name a workspace ' +
      'member as assignee (resolve uncertainty with searchIssues first). Returns the created ' +
      'issue id, title, status, priority and project.',
    inputSchema: copilotCreateIssueInputSchema,
    execute: async (rawInput) => {
      const { userName } = await assertMembership(context)

      const parsed = copilotCreateIssueInputSchema.safeParse(rawInput)
      if (!parsed.success) {
        return {
          created: false as const,
          error: `Invalid input: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
        }
      }
      const { projectId, title, description, priority, status, assigneeName } = parsed.data

      // Tenancy check: the project must exist AND belong to the active
      // workspace. A valid id from another workspace is rejected here.
      const project = await db.project.findUnique({
        where: { id: projectId },
        select: { id: true, name: true, workspaceId: true },
      })
      if (!project || project.workspaceId !== context.workspaceId) {
        return {
          created: false as const,
          error:
            'That projectId does not exist in the active workspace. ' +
            'Call getWorkspaceSummary to get valid project ids and try again.',
        }
      }

      let assigneeId: string | null = null
      let resolvedAssigneeName: string | null = null
      if (assigneeName) {
        const members = await db.workspaceMember.findMany({
          where: {
            workspaceId: context.workspaceId,
            user: { name: { contains: assigneeName } },
          },
          select: { userId: true, user: { select: { name: true } } },
          take: 5,
        })
        const exact = members.find(
          (member) => member.user.name.toLowerCase() === assigneeName.toLowerCase(),
        )
        const picked = exact ?? members[0]
        if (!picked) {
          return {
            created: false as const,
            error: `No workspace member named "${assigneeName}". Create the issue without an assignee, or ask the user who should own it.`,
          }
        }
        assigneeId = picked.userId
        resolvedAssigneeName = picked.user.name
      }

      // Append at the end of the target column with fractional-style spacing.
      const lastInColumn = await db.issue.findFirst({
        where: { projectId: project.id, status },
        orderBy: { position: 'desc' },
        select: { position: true },
      })
      const position = (lastInColumn?.position ?? 0) + POSITION_STEP

      const issue = await db.issue.create({
        data: {
          title,
          description: description ?? null,
          status,
          priority,
          position,
          projectId: project.id,
          assigneeId,
          createdById: context.userId,
        },
      })

      await db.activity.create({
        data: {
          type: 'ISSUE_CREATED',
          message: `${userName} created this issue via Copilot`,
          issueId: issue.id,
          projectId: project.id,
          actorId: context.userId,
        },
      })

      // Board viewers (and the Copilot client itself) refresh instantly.
      await publish(
        [roomForProject(project.id)],
        'issue:sync',
        { projectId: project.id, issueId: issue.id, reason: 'created' },
      )

      return {
        created: true as const,
        issueId: issue.id,
        title: issue.title,
        status: issue.status,
        priority: issue.priority,
        project: project.name,
        assignee: resolvedAssigneeName,
      }
    },
  })
}

/**
 * Builds the toolset for one Copilot request. The returned object is passed
 * straight to `streamText({ tools })`; each tool closes over the verified
 * session context, never over client-supplied ids.
 */
export function createWorkspaceTools(context: CopilotContext) {
  return {
    getWorkspaceSummary: getWorkspaceSummary(context),
    searchIssues: searchIssues(context),
    createIssueTool: createIssueTool(context),
  }
}

export type WorkspaceTools = ReturnType<typeof createWorkspaceTools>
