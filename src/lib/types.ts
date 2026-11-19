/**
 * Shared domain types and constants used by both server and client code.
 * Everything here is serializable: DTOs cross the Server Action boundary
 * as plain JSON, so dates are ISO strings.
 */

export const WORKSPACE_ROLES = ['OWNER', 'ADMIN', 'MEMBER'] as const
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number]

export const ISSUE_STATUSES = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'DONE'] as const
export type IssueStatus = (typeof ISSUE_STATUSES)[number]

export const ISSUE_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number]

/** Higher rank = more privileges. */
export const ROLE_RANK: Record<WorkspaceRole, number> = {
  OWNER: 3,
  ADMIN: 2,
  MEMBER: 1,
}

export function roleAtLeast(role: string, min: WorkspaceRole): boolean {
  const rank = ROLE_RANK[role as WorkspaceRole]
  if (rank === undefined) return false
  return rank >= ROLE_RANK[min]
}

export const STATUS_ORDER: readonly IssueStatus[] = ISSUE_STATUSES

export const STATUS_LABELS: Record<IssueStatus, string> = {
  BACKLOG: 'Backlog',
  TODO: 'To Do',
  IN_PROGRESS: 'In Progress',
  DONE: 'Done',
}

export const PRIORITY_LABELS: Record<IssuePriority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent',
}

/** Tailwind classes per priority — kept as plain strings so this file stays client-safe. */
export const PRIORITY_STYLES: Record<IssuePriority, string> = {
  LOW: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  MEDIUM: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  HIGH: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  URGENT: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
}

/** Rotating avatar palette. */
export const AVATAR_COLORS = [
  'bg-teal-600',
  'bg-amber-600',
  'bg-rose-600',
  'bg-violet-600',
  'bg-emerald-600',
  'bg-fuchsia-600',
] as const

export function avatarColorFor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

/* ---------------------------------- DTOs ---------------------------------- */

export type SessionUser = {
  id: string
  name: string
  email: string
}

export type MemberInfo = {
  membershipId: string
  userId: string
  name: string
  email: string
  role: WorkspaceRole
  joinedAt: string
}

export type ProjectSummary = {
  id: string
  name: string
  description: string | null
  issueCount: number
  createdAt: string
}

export type WorkspaceSummary = {
  id: string
  name: string
  role: WorkspaceRole
  memberCount: number
  projectCount: number
  createdAt: string
}

export type WorkspaceDetail = {
  workspace: { id: string; name: string }
  role: WorkspaceRole
  members: MemberInfo[]
  projects: ProjectSummary[]
}

export type IssueDTO = {
  id: string
  projectId: string
  title: string
  description: string | null
  status: IssueStatus
  priority: IssuePriority
  position: number
  assignee: { userId: string; name: string; email: string } | null
  createdBy: { userId: string; name: string }
  commentCount: number
  createdAt: string
  updatedAt: string
}

export type BoardData = {
  project: { id: string; name: string; description: string | null }
  workspaceId: string
  workspaceName: string
  issues: IssueDTO[]
}

export type TimelineEntry = {
  id: string
  kind: 'comment' | 'activity'
  /** For comments: the comment body. For activities: the human-readable change message. */
  body: string
  activityType: string | null
  actorId: string
  actorName: string
  createdAt: string
}

export type IssueDetailData = {
  issue: IssueDTO
  timeline: TimelineEntry[]
}

/** Standard result envelope for every Server Action. */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }

/**
 * Result envelope for the Workspace Settings actions
 * (src/actions/workspace-settings.ts): structured `{ success, error }`
 * responses as required by the settings feature brief.
 */
export type SettingsActionResult<T> = { success: true; data: T } | { success: false; error: string }

/* -------------------------------- AI assistant ---------------------------- */

/**
 * Structured payload produced by POST /api/ai/enhance-issue. The AI turns a
 * rough note into a crisp issue title, a Markdown description (Context +
 * Acceptance Criteria) and one of the board priorities.
 */
export type EnhancedIssue = {
  title: string
  description: string
  priority: IssuePriority
}

/**
 * Response shape of the AI enhance endpoint. `mock: true` means no live
 * model backend was available (missing ZAI_API_KEY and no sandbox gateway
 * config, or the live call failed) and a deterministic placeholder was
 * returned so the UI can be exercised end-to-end.
 */
export type EnhanceIssueResponse =
  | { success: true; data: EnhancedIssue; mock: boolean }
  | { success: false; error: string }

/** Tailwind classes per workspace role — client-safe plain strings. */
export const ROLE_BADGE_CLASSES: Record<WorkspaceRole, string> = {
  OWNER: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  ADMIN: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  MEMBER: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
}

/* ------------------------------ Realtime events --------------------------- */

export type IssueSyncEvent = {
  projectId: string
  issueId: string | null
  reason: 'created' | 'updated' | 'moved' | 'deleted' | 'comment'
}

export type WorkspaceSyncEvent = {
  workspaceId: string
  reason:
    | 'member_added'
    | 'member_removed'
    | 'role_changed'
    | 'project_created'
    | 'project_deleted'
    | 'workspace_renamed'
    | 'workspace_deleted'
}

export type SocketJoinPayload = {
  rooms: string[]
}

export const roomForProject = (projectId: string) => `project:${projectId}`
export const roomForWorkspace = (workspaceId: string) => `workspace:${workspaceId}`
