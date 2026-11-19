/**
 * Endpoint-level verification for POST /api/ai/copilot.
 * Uses a real session cookie (computed from AUTH_SECRET, never printed).
 *
 * Scenarios:
 *   1. unauthenticated        -> 401
 *   2. malformed body         -> 400
 *   3. non-member workspace   -> 403 (RBAC isolation)
 *   4. summary question       -> 200 stream, getWorkspaceSummary tool call
 *   5. create-issue request   -> 200 stream, createIssueTool, issue in DB
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

function readStream(response, onChunk) {
  return new Promise((resolve, reject) => {
    let raw = ''
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    function pump() {
      reader
        .read()
        .then(({ done, value }) => {
          if (done) return resolve(raw)
          const text = decoder.decode(value, { stream: true })
          raw += text
          onChunk?.(text)
          pump()
        })
        .catch(reject)
    }
    pump()
  })
}

async function main() {
  loadEnv()
  const prisma = new PrismaClient()
  const ada = await prisma.user.findUnique({ where: { email: 'ada@acme.dev' } })
  const workspace = await prisma.workspace.findFirst()
  if (!ada || !workspace) throw new Error('Missing demo user or workspace — seed first')

  const secret = process.env.AUTH_SECRET
  const mac = createHmac('sha256', secret).update(ada.id).digest('hex')
  const cookie = `mini_linear_session=${ada.id}.${mac}`
  const url = 'http://localhost:3000/api/ai/copilot'

  // 1. Unauthenticated
  const unauth = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId: workspace.id, messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }] }),
  })
  console.log('1) unauth:', unauth.status, JSON.stringify(await unauth.json()).slice(0, 110))

  // 2. Malformed body (missing messages)
  const bad = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ workspaceId: workspace.id }),
  })
  console.log('2) malformed:', bad.status, JSON.stringify(await bad.json()).slice(0, 110))

  // 3. RBAC isolation — workspace Ada does not belong to
  const outsider = await prisma.workspace.create({ data: { name: 'RBAC Probe Workspace (temp)', ownerId: ada.id } })
  const rbac = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ workspaceId: outsider.id, messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }] }),
  })
  console.log('3) non-member:', rbac.status, JSON.stringify(await rbac.json()).slice(0, 110))

  // 4. Summary question — expect getWorkspaceSummary tool call
  const issuesBefore = await prisma.issue.count({ where: { project: { workspaceId: workspace.id } } })
  const summary = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      workspaceId: workspace.id,
      messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Give me a quick status report: how many issues in each status, and what urgent work is open?' }] }],
    }),
  })
  console.log('4) summary stream status:', summary.status)
  const summaryRaw = await readStream(summary)
  const sawSummaryTool = summaryRaw.includes('"toolName":"getWorkspaceSummary"')
  console.log('   getWorkspaceSummary tool seen:', sawSummaryTool, '| stream bytes:', summaryRaw.length)
  const textMatches = [...summaryRaw.matchAll(/"delta":"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).join('').replace(/\\n/g, '\n')
  console.log('   streamed answer (first 400):', textMatches.slice(0, 400))

  // 5. Create-issue request — expect createIssueTool + DB row
  const create = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      workspaceId: workspace.id,
      messages: [{ id: 'm2', role: 'user', parts: [{ type: 'text', text: 'Create a high-priority task in any project to audit API rate limits.' }] }],
    }),
  })
  console.log('5) create stream status:', create.status)
  const createRaw = await readStream(create)
  const sawCreateTool =
    createRaw.includes('"toolName":"createIssueTool"') && createRaw.includes('"created":true')
  const issuesAfter = await prisma.issue.count({ where: { project: { workspaceId: workspace.id } } })
  const created = await prisma.issue.findFirst({
    where: { title: { contains: 'rate limit' } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, title: true, priority: true, status: true, project: { select: { name: true } }, assignee: { select: { name: true } } },
  })
  console.log('   createIssueTool success seen:', sawCreateTool)
  console.log('   issue count:', issuesBefore, '->', issuesAfter)
  console.log('   created issue:', JSON.stringify(created))

  await prisma.workspace.delete({ where: { id: outsider.id } })
  await prisma.$disconnect()
}

main().catch((error) => {
  console.error('TEST FAILED:', error.message)
  process.exit(1)
})
