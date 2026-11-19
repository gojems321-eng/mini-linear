import 'server-only'
import { db } from '@/lib/db'
import { auth } from '@/lib/session'
import { AppError } from '@/lib/errors'
import { roleAtLeast, type WorkspaceRole } from '@/lib/types'

/**
 * Tenancy guard. Every query and mutation for workspace-scoped data must go
 * through requireMember(): it resolves the current session and verifies the
 * user holds a WorkspaceMember row for the workspace that owns the resource.
 */

export type MembershipContext = {
  membershipId: string
  role: WorkspaceRole
  userId: string
  userName: string
  workspaceId: string
}

export async function requireMember(workspaceId: string): Promise<MembershipContext> {
  const session = await auth()
  if (!session) {
    throw new AppError('UNAUTHENTICATED', 'You must be signed in.')
  }

  const membership = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: session.userId } },
    select: { id: true, role: true, userId: true },
  })

  if (!membership) {
    throw new AppError('FORBIDDEN', 'You do not have access to this workspace.')
  }

  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: { name: true },
  })

  return {
    membershipId: membership.id,
    role: membership.role as WorkspaceRole,
    userId: membership.userId,
    userName: user?.name ?? 'Unknown',
    workspaceId,
  }
}

export function assertRole(actor: { role: WorkspaceRole }, min: WorkspaceRole): void {
  if (!roleAtLeast(actor.role, min)) {
    throw new AppError('FORBIDDEN', `This action requires the ${min} role or higher.`)
  }
}

/** Resolves the workspace that owns a project after verifying it exists. */
export async function requireProject(projectId: string) {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, description: true, workspaceId: true },
  })
  if (!project) {
    throw new AppError('NOT_FOUND', 'Project not found.')
  }
  return project
}

/** Resolves the workspace that owns an issue after verifying it exists. */
export async function requireIssue(issueId: string) {
  const issue = await db.issue.findUnique({
    where: { id: issueId },
    select: { id: true, projectId: true, project: { select: { id: true, workspaceId: true } } },
  })
  if (!issue) {
    throw new AppError('NOT_FOUND', 'Issue not found.')
  }
  return issue
}

/** Throws unless the given user is a member of the given workspace. */
export async function assertUserIsWorkspaceMember(
  workspaceId: string,
  userId: string,
): Promise<void> {
  const membership = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { id: true },
  })
  if (!membership) {
    throw new AppError('VALIDATION', 'Assignee must be a member of this workspace.')
  }
}
