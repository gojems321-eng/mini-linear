/**
 * Endpoint test for POST /api/ai/enhance-issue.
 * Builds a valid session cookie from AUTH_SECRET (never printed), then:
 *   1. unauthenticated call  -> expect 401
 *   2. authenticated empty prompt -> expect 400
 *   3. authenticated valid prompt -> expect 200 + structured live output
 */
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

function loadEnv() {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim())
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2]
  }
}

async function main() {
  loadEnv()
  const prisma = new PrismaClient()
  const user = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } })
  await prisma.$disconnect()
  if (!user) throw new Error('No user in DB — seed first')

  const secret = process.env.AUTH_SECRET
  const mac = createHmac('sha256', secret).update(user.id).digest('hex')
  const cookie = `mini_linear_session=${user.id}.${mac}`
  const base = 'http://localhost:3000/api/ai/enhance-issue'

  // 1. Unauthenticated
  const unauth = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rawInput: 'test without session' }),
  })
  console.log('1) unauth:', unauth.status, JSON.stringify(await unauth.json()).slice(0, 120))

  // 2. Empty prompt (authenticated)
  const empty = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ rawInput: '   ' }),
  })
  console.log('2) empty:', empty.status, JSON.stringify(await empty.json()).slice(0, 160))

  // 3. Missing field (authenticated)
  const missing = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ note: 'wrong field' }),
  })
  console.log('3) missing:', missing.status, JSON.stringify(await missing.json()).slice(0, 160))

  // 4. Valid prompt (authenticated) — live GLM
  const started = Date.now()
  const valid = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      rawInput:
        'workspace settings page still shows the old member list after inviting someone, maybe a cache problem, needs to refresh instantly',
    }),
  })
  const payload = await valid.json()
  console.log('4) valid:', valid.status, 'mock:', payload.mock, 'in', Date.now() - started, 'ms')
  console.log('   payload:', JSON.stringify(payload.data, null, 2).slice(0, 700))
}

main().catch((error) => {
  console.error('TEST FAILED:', error.message)
  process.exit(1)
})
