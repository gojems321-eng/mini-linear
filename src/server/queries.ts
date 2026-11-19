'use server'

import { db } from '@/lib/db'
import { auth } from '@/lib/session'
import { AppError } from '@/lib/errors'
import { requireMember } from '@/server/rbac'
import { mapIssue, mapMember } from '@/server/mapping'
import { getIssueDetailSchema } from '@/lib/validation'
import {
  ROLE_RANK,
  type BoardData,
  type IssueDetailData,
  type SessionUser,
  type WorkspaceDetail,
  type WorkspaceRole,
  type WorkspaceSummary,
} from '@/lib/types'

/**
 * Read-side Server Actions. Each one enforces tenancy before touching data,
 * so no client can ever read across workspace boundaries.
 */

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth()
  if (!session) return null
  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: { id: true, name: true, email: true },
  })
  return user
}

export async function listWorkspaces(): Promise<WorkspaceSummary[]> {
  const session = await auth()
  if (!session) return []

  const memberships = await db.workspaceMember.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: 'asc' },
    select: {
      role: true,
      workspace: {
        select: {
          id: true,
          name: true,
          createdAt: true,
          _count: { select: { members: true, projects: true } },
        },
      },
    },
  })

  return memberships.map((m) => ({
    id: m.workspace.id,
    name: m.workspace.name,
    role: m.role as WorkspaceRole,
    memberCount: m.workspace._count.members,
    projectCount: m.workspace._count.projects,
    createdAt: m.workspace.createdAt.toISOString(),
  }))
}

export async function getWorkspaceDetail(workspaceId: string): Promise<WorkspaceDetail> {
  const membership = await requireMember(workspaceId)

  const [workspace, memberRows, projects] = await Promise.all([
    db.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, name: true },
    }),
    db.workspaceMember.findMany({
      where: { workspaceId },
      select: {
        id: true,
        role: true,
        userId: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
    }),
    db.project.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        createdAt: true,
        _count: { select: { issues: true } },
      },
    }),
  ])

  if (!workspace) {
    throw new AppError('NOT_FOUND', 'Workspace not found.')
  }

  const members = memberRows
    .map(mapMember)
    .sort(
      (a, b) =>
        ROLE_RANK[b.role] - ROLE_RANK[a.role] ||
        a.joinedAt.localeCompare(b.joinedAt) ||
        a.name.localeCompare(b.name),
    )

  return {
    workspace: { id: workspace.id, name: workspace.name },
    role: membership.role,
    members,
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      issueCount: p._count.issues,
      createdAt: p.createdAt.toISOString(),
    })),
  }
}

export async function getBoard(projectId: string): Promise<BoardData> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      description: true,
      workspaceId: true,
      workspace: { select: { name: true } },
    },
  })
  if (!project) {
    throw new AppError('NOT_FOUND', 'Project not found.')
  }

  await requireMember(project.workspaceId)

  const issues = await db.issue.findMany({
    where: { projectId },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      projectId: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      position: true,
      createdAt: true,
      updatedAt: true,
      assignee: { select: { id: true, name: true, email: true } },
      createdBy: { select: { id: true, name: true } },
      _count: { select: { comments: true } },
    },
  })

  return {
    project: { id: project.id, name: project.name, description: project.description },
    workspaceId: project.workspaceId,
    workspaceName: project.workspace.name,
    issues: issues.map(mapIssue),
  }
}

export async function getIssueDetail(issueId: string): Promise<IssueDetailData> {
  const parsed = getIssueDetailSchema.parse({ issueId })

  const issue = await db.issue.findUnique({
    where: { id: parsed.issueId },
    select: { id: true, projectId: true, project: { select: { workspaceId: true } } },
  })
  if (!issue) {
    throw new AppError('NOT_FOUND', 'Issue not found.')
  }

  await requireMember(issue.project.workspaceId)

  const [fullIssue, comments, activities] = await Promise.all([
    db.issue.findUniqueOrThrow({
      where: { id: parsed.issueId },
      select: {
        id: true,
        projectId: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        position: true,
        createdAt: true,
        updatedAt: true,
        assignee: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true } },
        _count: { select: { comments: true } },
      },
    }),
    db.comment.findMany({
      where: { issueId: parsed.issueId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        body: true,
        createdAt: true,
        authorId: true,
        author: { select: { name: true } },
      },
    }),
    db.activity.findMany({
      where: { issueId: parsed.issueId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        type: true,
        message: true,
        createdAt: true,
        actorId: true,
        actor: { select: { name: true } },
      },
    }),
  ])

  const timeline = [
    ...comments.map((c) => ({
      id: c.id,
      kind: 'comment' as const,
      body: c.body,
      activityType: null,
      actorId: c.authorId,
      actorName: c.author.name,
      createdAt: c.createdAt.toISOString(),
    })),
    ...activities.map((a) => ({
      id: a.id,
      kind: 'activity' as const,
      body: a.message,
      activityType: a.type,
      actorId: a.actorId,
      actorName: a.actor.name,
      createdAt: a.createdAt.toISOString(),
    })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return { issue: mapIssue(fullIssue), timeline }
}
