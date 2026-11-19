import { z } from 'zod'
import { WORKSPACE_ROLES } from '@/lib/types'

/**
 * Zod v4 schemas for every Workspace Settings mutation. These are the
 * application-boundary enforcement of the string `role` column in SQLite
 * (see prisma/schema.prisma) and are consumed exclusively by
 * src/actions/workspace-settings.ts.
 */

const cuidLike = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/, 'Invalid identifier')

const workspaceName = z
  .string()
  .trim()
  .min(2, 'Workspace name must be at least 2 characters.')
  .max(60, 'Workspace name must be at most 60 characters.')

/** Creates a new workspace (caller becomes its sole OWNER). */
export const createWorkspaceSchema = z.object({
  name: workspaceName,
})

/** Renames an existing workspace. OWNER-only, enforced in the action. */
export const updateWorkspaceSchema = z.object({
  workspaceId: cuidLike,
  name: workspaceName,
})

/**
 * Invites a member by email. The invitee role can only be ADMIN or MEMBER —
 * the OWNER seat is never granted through invites, only through a role
 * update performed by the current owner.
 */
export const inviteMemberSchema = z.object({
  workspaceId: cuidLike,
  email: z.email('Enter a valid email address.').max(200),
  role: z.enum(['ADMIN', 'MEMBER']),
})

/**
 * Sets a member's role. Accepts all three roles because the OWNER may grant
 * the OWNER seat to another member (ownership transfer). Which combinations
 * a caller may perform is decided by the RBAC logic in the action, not here.
 */
export const updateMemberRoleSchema = z.object({
  workspaceId: cuidLike,
  membershipId: cuidLike,
  role: z.enum(WORKSPACE_ROLES),
})

/** Removes a member from the workspace (deletes only the membership row). */
export const removeMemberSchema = z.object({
  workspaceId: cuidLike,
  membershipId: cuidLike,
})

/** Deletes a workspace and, via cascade rules, everything inside it. */
export const deleteWorkspaceSchema = z.object({
  workspaceId: cuidLike,
})

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>
export type RemoveMemberInput = z.infer<typeof removeMemberSchema>
export type DeleteWorkspaceInput = z.infer<typeof deleteWorkspaceSchema>
