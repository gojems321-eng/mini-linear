import { z } from 'zod'
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from '@/lib/types'

/**
 * Zod schemas for the AI features of Mini-Linear.
 *
 * - `enhanceIssueSchema` / `enhancedIssueSchema` guard the Issue Assistant
 *   endpoint (POST /api/ai/enhance-issue): the caller must send a non-trivial
 *   `rawInput` string; the model's structured output is validated with
 *   normalisation-first tolerances so model quirks (lowercased priorities,
 *   over-long titles) don't discard a usable suggestion.
 * - `copilotChatSchema` + the two tool-input schemas guard the Agentic
 *   Workspace Copilot (POST /api/ai/copilot) and its Prisma-backed tools.
 */

export const enhanceIssueSchema = z.object({
  rawInput: z
    .string({ error: 'Provide your rough note as a rawInput string.' })
    .trim()
    .min(3, 'Add at least a few words describing the issue before enhancing.')
    .max(4000, 'Keep the raw note under 4000 characters.'),
})

function clamp(value: unknown, max: number): unknown {
  return typeof value === 'string' ? value.trim().slice(0, max).trim() : value
}

export const enhancedIssueSchema = z.object({
  title: z.preprocess(
    (value) => clamp(value, 140),
    z.string().min(3, 'AI returned a title that is too short.').max(140),
  ),
  description: z.preprocess(
    (value) => clamp(value, 3000),
    z.string().min(1, 'AI returned an empty description.'),
  ),
  priority: z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().toUpperCase() : value),
    z.enum(ISSUE_PRIORITIES, { error: 'AI returned an unknown priority.' }),
  ),
})

/* ------------------------------ Workspace Copilot -------------------------- */

const cuidLike = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/, 'Invalid identifier')

const uiMessageSchema = z.looseObject({
  id: z.string().min(1).max(128),
  role: z.enum(['system', 'user', 'assistant']),
  parts: z.array(z.looseObject({ type: z.string() })).min(1),
})

/** Body of POST /api/ai/copilot sent by the Copilot drawer. */
export const copilotChatSchema = z.object({
  workspaceId: cuidLike,
  messages: z.array(uiMessageSchema).min(1).max(60),
})

/** Input schema for the `searchIssues` copilot tool. */
export const copilotSearchIssuesInputSchema = z.object({
  query: z.string().trim().max(120).optional(),
  status: z.enum(ISSUE_STATUSES).optional(),
  priority: z.enum(ISSUE_PRIORITIES).optional(),
  assigneeName: z.string().trim().max(80).optional(),
  limit: z.number().int().min(1).max(25).default(10),
})

/**
 * Input schema for the `createIssueTool` copilot tool. The model addresses
 * the assignee by NAME (it learns names from the other tools' outputs);
 * the tool resolves it against workspace members before writing.
 */
export const copilotCreateIssueInputSchema = z.object({
  projectId: cuidLike,
  title: z.string().trim().min(3, 'Issue title must be at least 3 characters.').max(140),
  description: z.string().trim().max(3000).optional(),
  priority: z.enum(ISSUE_PRIORITIES).default('MEDIUM'),
  status: z.enum(ISSUE_STATUSES).default('TODO'),
  assigneeName: z.string().trim().min(2).max(80).optional(),
})
