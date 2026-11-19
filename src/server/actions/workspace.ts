'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { auth, createSession, destroySession } from '@/lib/session'
import { AppError, action } from '@/lib/errors'
import { prettifyEmail } from '@/server/mapping'
import { signInSchema } from '@/lib/validation'
import { createWorkspaceSchema } from '@/lib/validations/workspace'
import type { ActionResult, SessionUser } from '@/lib/types'

/**
 * Session and workspace-creation actions. Member and workspace management
 * (invite, roles, removal, rename, delete) lives in
 * src/actions/workspace-settings.ts with its stricter RBAC matrix.
 */

/* --------------------------------- Session -------------------------------- */

/**
 * Signs a user in by email. Unknown emails auto-provision a local account
 * (demo-grade identity); in production this would be an email-magic-link or
 * OAuth flow behind the same `auth()` contract.
 */
export async function signInAction(input: unknown): Promise<ActionResult<SessionUser>> {
  return action(async () => {
    const parsed = signInSchema.parse(input)
    const email = parsed.email.toLowerCase()

    let user = await db.user.findUnique({ where: { email } })
    if (!user) {
      user = await db.user.create({
        data: { email, name: parsed.name?.trim() || prettifyEmail(email) },
      })
    }

    await createSession(user.id)
    revalidatePath('/')
    return { id: user.id, name: user.name, email: user.email }
  })
}

export async function signOutAction(): Promise<ActionResult<null>> {
  return action(async () => {
    await destroySession()
    revalidatePath('/')
    return null
  })
}

/* -------------------------------- Workspace ------------------------------- */

export async function createWorkspaceAction(
  input: unknown,
): Promise<ActionResult<{ workspaceId: string }>> {
  return action(async () => {
    const session = await auth()
    if (!session) {
      throw new AppError('UNAUTHENTICATED', 'You must be signed in.')
    }

    const parsed = createWorkspaceSchema.parse(input)

    const workspace = await db.$transaction(async (tx) => {
      const created = await tx.workspace.create({
        data: { name: parsed.name, ownerId: session.userId },
      })
      await tx.workspaceMember.create({
        data: { workspaceId: created.id, userId: session.userId, role: 'OWNER' },
      })
      return created
    })

    revalidatePath('/')
    return { workspaceId: workspace.id }
  })
}
