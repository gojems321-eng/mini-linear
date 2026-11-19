'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { action } from '@/lib/errors'
import { requireIssue, requireMember } from '@/server/rbac'
import { publish } from '@/server/realtime'
import { addCommentSchema } from '@/lib/validation'
import { roomForProject, type ActionResult } from '@/lib/types'

/**
 * Adds a comment to an issue and broadcasts to everyone viewing the project.
 * The comment appears in the issue modal's unified timeline alongside
 * activity entries.
 */
export async function addCommentAction(
  input: unknown,
): Promise<ActionResult<{ commentId: string }>> {
  return action(async () => {
    const parsed = addCommentSchema.parse(input)
    const issueRef = await requireIssue(parsed.issueId)
    const actor = await requireMember(issueRef.project.workspaceId)

    const comment = await db.comment.create({
      data: {
        body: parsed.body,
        issueId: issueRef.id,
        authorId: actor.userId,
      },
    })

    await publish([roomForProject(issueRef.project.id)], 'issue:sync', {
      projectId: issueRef.project.id,
      issueId: issueRef.id,
      reason: 'comment',
    })
    revalidatePath('/')
    return { commentId: comment.id }
  })
}
