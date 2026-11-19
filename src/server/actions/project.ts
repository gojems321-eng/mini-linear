'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { AppError, action } from '@/lib/errors'
import { requireMember, assertRole, requireProject } from '@/server/rbac'
import { publish } from '@/server/realtime'
import { createProjectSchema, deleteProjectSchema } from '@/lib/validation'
import { roomForWorkspace, type ActionResult } from '@/lib/types'

export async function createProjectAction(
  input: unknown,
): Promise<ActionResult<{ projectId: string }>> {
  return action(async () => {
    const parsed = createProjectSchema.parse(input)
    const actor = await requireMember(parsed.workspaceId)

    const existing = await db.project.findFirst({
      where: { workspaceId: parsed.workspaceId, name: parsed.name },
      select: { id: true },
    })
    if (existing) {
      throw new AppError('CONFLICT', `A project named "${parsed.name}" already exists.`)
    }

    const project = await db.project.create({
      data: {
        name: parsed.name,
        description: parsed.description ?? null,
        workspaceId: parsed.workspaceId,
        createdById: actor.userId,
      },
    })

    await publish([roomForWorkspace(parsed.workspaceId)], 'workspace:sync', {
      workspaceId: parsed.workspaceId,
      reason: 'project_created',
    })
    revalidatePath('/')
    return { projectId: project.id }
  })
}

/**
 * Deleting a project cascades to its issues, comments and activities.
 * Restricted to OWNER and ADMIN per the RBAC spec.
 */
export async function deleteProjectAction(input: unknown): Promise<ActionResult<null>> {
  return action(async () => {
    const parsed = deleteProjectSchema.parse(input)
    const project = await requireProject(parsed.projectId)
    const actor = await requireMember(project.workspaceId)
    assertRole(actor, 'ADMIN')

    if (project.workspaceId !== parsed.workspaceId) {
      throw new AppError('VALIDATION', 'Project does not belong to this workspace.')
    }

    await db.project.delete({ where: { id: project.id } })

    await publish([roomForWorkspace(parsed.workspaceId)], 'workspace:sync', {
      workspaceId: parsed.workspaceId,
      reason: 'project_deleted',
    })
    revalidatePath('/')
    return null
  })
}
