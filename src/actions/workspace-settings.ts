'use server'

import { revalidatePath } from 'next/cache'
import { ZodError } from 'zod'
import { db } from '@/lib/db'
import { auth } from '@/lib/session'
import { AppError } from '@/lib/errors'
import { requireMember } from '@/server/rbac'
import { mapMember, prettifyEmail } from '@/server/mapping'
import { publish } from '@/server/realtime'
import { roleAtLeast, roomForWorkspace } from '@/lib/types'
import type { MemberInfo, SettingsActionResult, WorkspaceRole } from '@/lib/types'
import {
  deleteWorkspaceSchema,
  inviteMemberSchema,
  removeMemberSchema,
  updateMemberRoleSchema,
  updateWorkspaceSchema,
} from '@/lib/validations/workspace'

/**
 * Workspace Settings mutations. Every action:
 *   1. verifies the session via auth() (through requireMember),
 *   2. re-checks the caller's WorkspaceMember role against the DB,
 *   3. applies the permission matrix plus the sole-owner guardrails,
 *   4. revalidates '/' so server-rendered data stays fresh,
 *   5. returns a structured { success, error } response — never throws to
 *      the client.
 *
 * Permission matrix (enforced here; the UI mirrors it and HIDES controls):
 *   OWNER  rename + delete workspace, invite, any role change incl. granting
 *          OWNER (transfer), remove any member except the sole-owner self.
 *   ADMIN  invite, move seats between ADMIN and MEMBER, remove MEMBER seats.
 *          Never touches OWNER seats, never grants OWNER, never renames or
 *          deletes the workspace.
 *   MEMBER read-only — every mutation below rejects with FORBIDDEN.
 */

/* ------------------------------ Envelope helper ---------------------------- */

async function runSettings<T>(fn: () => Promise<T>): Promise<SettingsActionResult<T>> {
  try {
    return { success: true, data: await fn() }
  } catch (error) {
    if (error instanceof AppError) {
      return { success: false, error: error.message }
    }
    if (error instanceof ZodError) {
      const issue = error.issues[0]
      if (!issue) return { success: false, error: 'Invalid input.' }
      const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
      return { success: false, error: `${path}${issue.message}` }
    }
    // Prisma unique-constraint violations surface as P2002 (duplicate
    // memberships are normally caught earlier with a clearer message).
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    ) {
      return { success: false, error: 'That member already belongs to this workspace.' }
    }
    console.error('[workspace-settings]', error)
    return { success: false, error: 'Something went wrong. Please try again.' }
  }
}

async function assertAuthenticated(): Promise<void> {
  const session = await auth()
  if (!session) {
    throw new AppError('UNAUTHENTICATED', 'You must be signed in.')
  }
}

async function countOwners(workspaceId: string): Promise<number> {
  return db.workspaceMember.count({ where: { workspaceId, role: 'OWNER' } })
}

function assertAdmin(actor: { role: WorkspaceRole }, verb: string): void {
  if (!roleAtLeast(actor.role, 'ADMIN')) {
    throw new AppError('FORBIDDEN', `Only owners and admins can ${verb}.`)
  }
}

/* ----------------------------- Rename workspace ---------------------------- */

export async function updateWorkspaceAction(
  input: unknown,
): Promise<SettingsActionResult<{ id: string; name: string }>> {
  return runSettings(async () => {
    await assertAuthenticated()
    const parsed = updateWorkspaceSchema.parse(input)
    const actor = await requireMember(parsed.workspaceId)

    if (actor.role !== 'OWNER') {
      throw new AppError('FORBIDDEN', 'Only the workspace owner can rename the workspace.')
    }

    const workspace = await db.workspace.update({
      where: { id: parsed.workspaceId },
      data: { name: parsed.name },
      select: { id: true, name: true },
    })

    await publish([roomForWorkspace(parsed.workspaceId)], 'workspace:sync', {
      workspaceId: parsed.workspaceId,
      reason: 'workspace_renamed',
    })
    revalidatePath('/')
    return workspace
  })
}

/* ------------------------------ Invite member ------------------------------ */

/**
 * Invites a member by email. Unknown emails auto-provision a local account
 * (demo-grade identity) so the invitee can sign in immediately with the same
 * address — no pending-record limbo. Duplicate memberships are rejected with
 * a CONFLICT before hitting the DB-level unique constraint.
 */
export async function inviteMemberAction(input: unknown): Promise<SettingsActionResult<MemberInfo>> {
  return runSettings(async () => {
    await assertAuthenticated()
    const parsed = inviteMemberSchema.parse(input)
    const actor = await requireMember(parsed.workspaceId)
    assertAdmin(actor, 'invite members')

    const email = parsed.email.toLowerCase()
    let invitee = await db.user.findUnique({ where: { email } })
    if (!invitee) {
      invitee = await db.user.create({ data: { email, name: prettifyEmail(email) } })
    }

    const existing = await db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: parsed.workspaceId, userId: invitee.id } },
    })
    if (existing) {
      throw new AppError('CONFLICT', `${invitee.name} is already a member of this workspace.`)
    }

    const created = await db.workspaceMember.create({
      data: { workspaceId: parsed.workspaceId, userId: invitee.id, role: parsed.role },
      include: { user: { select: { id: true, name: true, email: true } } },
    })

    await publish([roomForWorkspace(parsed.workspaceId)], 'workspace:sync', {
      workspaceId: parsed.workspaceId,
      reason: 'member_added',
    })
    revalidatePath('/')
    return mapMember(created)
  })
}

/* ----------------------------- Change member role -------------------------- */

export async function updateMemberRoleAction(
  input: unknown,
): Promise<SettingsActionResult<MemberInfo>> {
  return runSettings(async () => {
    await assertAuthenticated()
    const parsed = updateMemberRoleSchema.parse(input)
    const actor = await requireMember(parsed.workspaceId)
    assertAdmin(actor, 'change member roles')

    const target = await db.workspaceMember.findFirst({
      where: { id: parsed.membershipId, workspaceId: parsed.workspaceId },
      include: { user: { select: { id: true, name: true, email: true } } },
    })
    if (!target) {
      throw new AppError('NOT_FOUND', 'Member not found in this workspace.')
    }
    const targetRole = target.role as WorkspaceRole

    // ADMIN ceiling: admins may only move seats between ADMIN and MEMBER.
    if (actor.role !== 'OWNER') {
      if (parsed.role === 'OWNER') {
        throw new AppError('FORBIDDEN', 'Only the workspace owner can grant the OWNER role.')
      }
      if (targetRole === 'OWNER') {
        throw new AppError('FORBIDDEN', 'Admins cannot change the role of an owner.')
      }
    }

    // Sole-owner guardrail: an OWNER seat (including the caller's own) can
    // only be demoted while at least one other OWNER remains.
    if (targetRole === 'OWNER' && parsed.role !== 'OWNER') {
      const ownerCount = await countOwners(parsed.workspaceId)
      if (ownerCount <= 1) {
        throw new AppError(
          'VALIDATION',
          'The sole owner cannot be demoted. Promote another owner first to transfer ownership.',
        )
      }
    }

    if (targetRole === parsed.role) {
      throw new AppError('VALIDATION', `${target.user.name} already has the ${parsed.role} role.`)
    }

    const updated = await db.workspaceMember.update({
      where: { id: target.id },
      data: { role: parsed.role },
      include: { user: { select: { id: true, name: true, email: true } } },
    })

    await publish([roomForWorkspace(parsed.workspaceId)], 'workspace:sync', {
      workspaceId: parsed.workspaceId,
      reason: 'role_changed',
    })
    revalidatePath('/')
    return mapMember(updated)
  })
}

/* ------------------------------ Remove member ------------------------------ */

/**
 * Removes a member (the User record stays; only the membership row goes).
 * OWNER: may remove anyone except their own sole-owner seat. ADMIN: may
 * remove MEMBER seats only — never OWNERs and never fellow ADMINs.
 */
export async function removeMemberAction(input: unknown): Promise<SettingsActionResult<null>> {
  return runSettings(async () => {
    await assertAuthenticated()
    const parsed = removeMemberSchema.parse(input)
    const actor = await requireMember(parsed.workspaceId)
    assertAdmin(actor, 'remove members')

    const target = await db.workspaceMember.findFirst({
      where: { id: parsed.membershipId, workspaceId: parsed.workspaceId },
      select: { id: true, userId: true, role: true },
    })
    if (!target) {
      throw new AppError('NOT_FOUND', 'Member not found in this workspace.')
    }
    const targetRole = target.role as WorkspaceRole

    if (actor.role !== 'OWNER' && targetRole !== 'MEMBER') {
      throw new AppError('FORBIDDEN', 'Admins can only remove members, not owners or admins.')
    }

    const isSelf = target.userId === actor.userId
    if (isSelf && targetRole === 'OWNER') {
      const ownerCount = await countOwners(parsed.workspaceId)
      if (ownerCount <= 1) {
        throw new AppError(
          'VALIDATION',
          'The sole owner cannot leave the workspace. Promote another owner first.',
        )
      }
    }

    await db.workspaceMember.delete({ where: { id: target.id } })

    await publish([roomForWorkspace(parsed.workspaceId)], 'workspace:sync', {
      workspaceId: parsed.workspaceId,
      reason: 'member_removed',
    })
    revalidatePath('/')
    return null
  })
}

/* ----------------------------- Delete workspace ---------------------------- */

/**
 * Deletes the workspace. OWNER-only. All projects, issues, comments,
 * activities and memberships cascade via FK rules; User accounts survive so
 * members keep their other workspaces and demo sign-in.
 */
export async function deleteWorkspaceAction(input: unknown): Promise<SettingsActionResult<null>> {
  return runSettings(async () => {
    await assertAuthenticated()
    const parsed = deleteWorkspaceSchema.parse(input)
    const actor = await requireMember(parsed.workspaceId)

    if (actor.role !== 'OWNER') {
      throw new AppError('FORBIDDEN', 'Only the workspace owner can delete the workspace.')
    }

    await db.workspace.delete({ where: { id: parsed.workspaceId } })

    await publish([roomForWorkspace(parsed.workspaceId)], 'workspace:sync', {
      workspaceId: parsed.workspaceId,
      reason: 'workspace_deleted',
    })
    revalidatePath('/')
    return null
  })
}
