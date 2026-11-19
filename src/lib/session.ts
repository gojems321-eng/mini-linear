import 'server-only'
import { cookies } from 'next/headers'
import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import path from 'node:path'
import { db } from '@/lib/db'

/**
 * Session layer. Exposes the `auth()` helper required by the project brief:
 * returns `{ userId }` when a valid session cookie exists, otherwise null.
 *
 * The cookie carries `userId.<hmac-sha256>` signed with AUTH_SECRET, so a
 * client cannot forge a session id. Swapping this module for NextAuth later
 * only requires keeping the `auth()` signature.
 */

const COOKIE_NAME = 'mini_linear_session'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30 // 30 days

/**
 * AUTH_SECRET resolution order:
 * 1. `process.env.AUTH_SECRET` — the standard path: set it in Vercel (or any
 *    host) project settings. Serverless instances share it, so sessions are
 *    stable across invocations.
 * 2. the secret file — default `<cwd>/.auth-secret` (overridable via
 *    AUTH_SECRET_FILE). Survives restarts that reset .env, e.g. the hosted
 *    sandbox rewriting .env on boot.
 * 3. self-heal: generate a fresh secret and try to persist it to the file.
 *    On read-only filesystems (serverless without AUTH_SECRET set) the
 *    in-memory secret still works for the instance lifetime.
 */
const SECRET_FILE = process.env.AUTH_SECRET_FILE ?? path.join(process.cwd(), '.auth-secret')

let cachedSecret: string | null = null

function getSecret(): string {
  if (cachedSecret) return cachedSecret

  const fromEnv = process.env.AUTH_SECRET
  if (fromEnv && fromEnv.length >= 16) {
    cachedSecret = fromEnv
    return cachedSecret
  }

  try {
    if (existsSync(SECRET_FILE)) {
      const fromFile = readFileSync(SECRET_FILE, 'utf8').trim()
      if (fromFile.length >= 16) {
        cachedSecret = fromFile
        return cachedSecret
      }
    }
  } catch {
    // fall through to self-healing below
  }

  const generated = randomBytes(32).toString('hex')
  try {
    writeFileSync(SECRET_FILE, `${generated}\n`, { mode: 0o600 })
  } catch {
    // Even if persisting fails, the in-memory secret still works for this
    // server lifetime; the next restart simply re-generates.
  }
  cachedSecret = generated
  return cachedSecret
}

function signValue(value: string): string {
  const mac = createHmac('sha256', getSecret()).update(value).digest('hex')
  return `${value}.${mac}`
}

function verifyValue(signed: string | undefined): string | null {
  if (!signed) return null
  const separator = signed.lastIndexOf('.')
  if (separator <= 0) return null
  const value = signed.slice(0, separator)
  const mac = signed.slice(separator + 1)
  const expected = createHmac('sha256', getSecret()).update(value).digest('hex')
  const given = Buffer.from(mac, 'utf8')
  const want = Buffer.from(expected, 'utf8')
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return null
  }
  return value
}

export async function auth(): Promise<{ userId: string } | null> {
  const store = await cookies()
  const userId = verifyValue(store.get(COOKIE_NAME)?.value)
  if (!userId) return null

  // Guard against sessions pointing at deleted users.
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true },
  })
  return user ? { userId: user.id } : null
}

export async function createSession(userId: string): Promise<void> {
  const store = await cookies()
  store.set(COOKIE_NAME, signValue(userId), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  })
}

export async function destroySession(): Promise<void> {
  const store = await cookies()
  store.delete(COOKIE_NAME)
}
