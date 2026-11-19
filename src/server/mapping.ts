import 'server-only'
import type { MemberInfo, IssueDTO, IssuePriority, IssueStatus } from '@/lib/types'

/**
 * Row-to-DTO mappers shared by queries and Server Actions. Keeping the shapes
 * in one place guarantees the client always receives plain JSON (ISO dates).
 */

type MemberRow = {
  id: string
  role: string
  userId: string
  createdAt: Date
  user: { id: string; name: string; email: string }
}

export function mapMember(m: MemberRow): MemberInfo {
  return {
    membershipId: m.id,
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
    role: m.role as MemberInfo['role'],
    joinedAt: m.createdAt.toISOString(),
  }
}

type IssueRow = {
  id: string
  projectId: string
  title: string
  description: string | null
  status: string
  priority: string
  position: number
  assignee: { id: string; name: string; email: string } | null
  createdBy: { id: string; name: string }
  _count?: { comments: number }
  createdAt: Date
  updatedAt: Date
}

export function mapIssue(i: IssueRow): IssueDTO {
  return {
    id: i.id,
    projectId: i.projectId,
    title: i.title,
    description: i.description,
    status: i.status as IssueStatus,
    priority: i.priority as IssuePriority,
    position: i.position,
    assignee: i.assignee
      ? { userId: i.assignee.id, name: i.assignee.name, email: i.assignee.email }
      : null,
    createdBy: { userId: i.createdBy.id, name: i.createdBy.name },
    commentCount: i._count?.comments ?? 0,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
  }
}

/** Derives a readable display name from the local part of an email address. */
export function prettifyEmail(email: string): string {
  const local = email.split('@')[0] ?? ''
  const words = local
    .split(/[._\-+]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
  return words.length > 0 ? words.join(' ') : 'New Member'
}
