/**
 * Probe #2: does the Vercel AI SDK's generateObject work against the
 * sandbox's internal Z.AI gateway (OpenAI-compatible /chat/completions)?
 * Credentials are read from /etc/.z-ai-config but never printed.
 */
import { generateText, Output } from 'ai'
import { createZai } from '@ai-sdk/zai'
import { z } from 'zod'
import { readFileSync } from 'node:fs'

function loadInternalConfig() {
  for (const p of ['/etc/.z-ai-config', `${process.env.HOME}/.z-ai-config`]) {
    try {
      const c = JSON.parse(readFileSync(p, 'utf8'))
      if (c.baseUrl && c.apiKey) return c
    } catch {}
  }
  return null
}

async function main() {
  const cfg = loadInternalConfig()
  console.log('internal config found:', !!cfg)

  const headers = { 'X-Z-AI-From': 'Z' }
  if (cfg.chatId) headers['X-Chat-Id'] = cfg.chatId
  if (cfg.userId) headers['X-User-Id'] = cfg.userId
  if (cfg.token) headers['X-Token'] = cfg.token

  const provider = createZai({
    baseURL: cfg.baseUrl,
    apiKey: cfg.apiKey,
    headers,
  })
  const model = provider('glm-5.3-flash')

  const schema = z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    priority: z.preprocess(
      (v) => (typeof v === 'string' ? v.trim().toUpperCase() : v),
      z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
    ),
  })

  const started = Date.now()
  const { output } = await generateText({
    model,
    output: Output.object({ schema }),
    system: 'You turn rough product notes into crisp issue-tracker entries. Output only the structured data. priority must be exactly one of LOW, MEDIUM, HIGH, URGENT (uppercase).',
    prompt: 'Rough note: "login button dead when clicked, users stuck, maybe CSRF or handler missing. needs fix today"',
  })
  console.log('generateText+Output OK in', Date.now() - started, 'ms')
  console.log(JSON.stringify(output, null, 2))
}

main().catch((error) => {
  console.log('PROBE FAILED:', error?.name, String(error?.message).slice(0, 300))
  if (error?.text) console.log('raw text:', String(error.text).slice(0, 600))
  if (error?.responseBody) console.log('responseBody:', String(error.responseBody).slice(0, 600))
  const cause = error?.cause
  if (cause) console.log('cause:', String(cause?.message ?? cause).slice(0, 600))
  const responses = error?.responses
  if (responses) console.log('responses:', JSON.stringify(responses).slice(0, 600))
  process.exit(1)
})
