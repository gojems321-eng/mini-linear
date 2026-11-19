import { ZodError } from 'zod'
import type { ActionResult } from '@/lib/types'

/**
 * Domain-level error with a stable code. Server Actions catch AppError and
 * surface `message` to the client; unexpected errors are logged and masked.
 */
export class AppError extends Error {
  constructor(
    public readonly code:
      | 'UNAUTHENTICATED'
      | 'FORBIDDEN'
      | 'NOT_FOUND'
      | 'CONFLICT'
      | 'VALIDATION',
    message: string,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

function firstZodMessage(error: ZodError): string {
  const issue = error.issues[0]
  if (!issue) return 'Invalid input.'
  const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
  return `${path}${issue.message}`
}

/**
 * Wraps a Server Action body so every failure becomes an ActionResult
 * instead of an unhandled rejection on the client.
 */
export async function action<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (error) {
    if (error instanceof AppError) {
      return { ok: false, error: error.message }
    }
    if (error instanceof ZodError) {
      return { ok: false, error: firstZodMessage(error) }
    }
    // Prisma unique-constraint violations surface as P2002.
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    ) {
      return { ok: false, error: 'That value already exists.' }
    }
    console.error('[server-action]', error)
    return { ok: false, error: 'Something went wrong. Please try again.' }
  }
}
