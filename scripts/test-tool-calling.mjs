/**
 * Probe #3: does the sandbox gateway support native tool calling
 * (OpenAI-compatible `tools` param) with glm-5.3-flash via @ai-sdk/zai?
 * Reads /etc/.z-ai-config but never prints credentials.
 */
import { generateText, stepCountIs, tool } from 'ai'
import { createZai } from '@ai-sdk/zai'
import { z } from 'zod'
import { readFileSync } from 'node:fs'

const cfg = JSON.parse(readFileSync('/etc/.z-ai-config', 'utf8'))
const headers = { 'X-Z-AI-From': 'Z' }
if (cfg.chatId) headers['X-Chat-Id'] = cfg.chatId
if (cfg.userId) headers['X-User-Id'] = cfg.userId
if (cfg.token) headers['X-Token'] = cfg.token

const provider = createZai({ baseURL: cfg.baseUrl, apiKey: cfg.apiKey, headers })

const countProjects = tool({
  description: 'Count the projects in the workspace. Use this whenever asked about projects.',
  inputSchema: z.object({}),
  execute: async () => ({ projectCount: 2, names: ['Web Platform', 'Mobile App'] }),
})

async function main() {
  const started = Date.now()
  const result = await generateText({
    model: provider('glm-5.3-flash'),
    stopWhen: stepCountIs(5),
    tools: { countProjects },
    prompt: 'How many projects are in our workspace and what are their names?',
  })
  console.log('steps:', result.steps.length, 'in', Date.now() - started, 'ms')
  for (const step of result.steps) {
    console.log('  step toolCalls:', JSON.stringify(step.toolCalls?.map((c) => c.toolName)))
    console.log('  step toolResults:', JSON.stringify(step.toolResults?.map((r) => r.toolName)))
  }
  console.log('final text:', result.text.slice(0, 300))
}

main().catch((error) => {
  console.log('PROBE FAILED:', error?.name, String(error?.message).slice(0, 400))
  if (error?.responseBody) console.log('body:', String(error.responseBody).slice(0, 300))
  process.exit(1)
})
