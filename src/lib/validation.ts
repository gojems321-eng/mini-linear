import { z } from 'zod'
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from '@/lib/types'

/**
 * Zod v4 schemas validating every Server Action input except workspace
 * settings mutations, which live in src/lib/validations/workspace.ts. The
 * status and priority enums here are the application-boundary enforcement
 * of the string columns in the SQLite schema (see prisma/schema.prisma).
 */

const cuidLike = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/, 'Invalid identifier')

export const signInSchema = z.object({
  email: z.email('Enter a valid email address.').max(200),
  name: z.string().trim().max(80).optional(),
})

export const createProjectSchema = z.object({
  workspaceId: cuidLike,
  name: z.string().trim().min(2, 'Project name must be at least 2 characters.').max(60),
  description: z.string().trim().max(280).optional(),
})

export const deleteProjectSchema = z.object({
  workspaceId: cuidLike,
  projectId: cuidLike,
})

export const createIssueSchema = z.object({
  projectId: cuidLike,
  title: z.string().trim().min(2, 'Title must be at least 2 characters.').max(140),
  description: z.string().trim().max(2000).optional(),
  status: z.enum(ISSUE_STATUSES),
  priority: z.enum(ISSUE_PRIORITIES),
  /** Workspace-member user id, or null to leave unassigned. */
  assigneeId: cuidLike.nullable().optional(),
})

export const updateIssueSchema = z.object({
  issueId: cuidLike,
  title: z.string().trim().min(2, 'Title must be at least 2 characters.').max(140).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  priority: z.enum(ISSUE_PRIORITIES).optional(),
  status: z.enum(ISSUE_STATUSES).optional(),
  /** null clears the assignment; undefined leaves it untouched. */
  assigneeId: cuidLike.nullable().optional(),
})

export const moveIssueSchema = z.object({
  issueId: cuidLike,
  status: z.enum(ISSUE_STATUSES),
  /** Target index within the destination column (0-based). */
  index: z.number().int().min(0).max(500),
})

export const deleteIssueSchema = z.object({
  issueId: cuidLike,
})

export const addCommentSchema = z.object({
  issueId: cuidLike,
  body: z.string().trim().min(1, 'Comment cannot be empty.').max(2000),
})

export const getIssueDetailSchema = z.object({
  issueId: cuidLike,
})

export type SignInInput = z.infer<typeof signInSchema>
export type CreateProjectInput = z.infer<typeof createProjectSchema>
export type DeleteProjectInput = z.infer<typeof deleteProjectSchema>
export type CreateIssueInput = z.infer<typeof createIssueSchema>
export type UpdateIssueInput = z.infer<typeof updateIssueSchema>
export type MoveIssueInput = z.infer<typeof moveIssueSchema>
export type DeleteIssueInput = z.infer<typeof deleteIssueSchema>
export type AddCommentInput = z.infer<typeof addCommentSchema>
export type GetIssueDetailInput = z.infer<typeof getIssueDetailSchema>
