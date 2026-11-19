import 'server-only'

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { createZai, type ZaiProvider } from '@ai-sdk/zai'
import { enhancedIssueSchema } from '@/lib/validations/ai'
import type { EnhancedIssue, IssuePriority } from '@/lib/types'

/**
 * AI backend resolution for the Issue Assistant and Workspace Copilot.
 *
 * The Vercel AI SDK talks to GLM through `@ai-sdk/zai` using
 * `zai('glm-5.3-flash')` (the flash tier keeps enhancements snappy). Three
 * environments are supported, resolved once and cached:
 *
 *   1. live-zai-api          — ZAI_API_KEY is present (the Vercel/production
 *                              path). The provider is pointed at the public
 *                              https://api.z.ai endpoint with the key passed
 *                              explicitly, and NO sandbox gateway fallback is
 *                              ever consulted in this mode.
 *   2. live-sandbox-gateway  — no ZAI_API_KEY, but a pre-authenticated
 *                              `.z-ai-config` file exists (local sandbox/CI
 *                              only; the file never exists on Vercel). The
 *                              same provider class is pointed at that
 *                              OpenAI-compatible gateway with its headers.
 *   3. mock                  — neither is available: `resolveAiProvider`
 *                              returns null and callers fall back to
 *                              `mockEnhancement` so the UI stays testable.
 */

export const AI_MODEL_ID = 'glm-5.3-flash'

export type AiMode = 'live-zai-api' | 'live-sandbox-gateway' | 'mock'

type GatewayConfig = {
  baseUrl: string
  apiKey: string
  headers: Record<string, string>
}

let cached: { provider: ZaiProvider | null; mode: AiMode } | undefined

/**
 * Local-development escape hatch only. Looks for a pre-authenticated gateway
 * config file that exists exclusively in the hosted sandbox; on Vercel or any
 * normal host neither candidate path exists, so this returns null and the
 * ladder moves on to the mock tier.
 */
function loadSandboxGatewayConfig(): GatewayConfig | null {
  const candidates = ['/etc/.z-ai-config', path.join(homedir(), '.z-ai-config')]
  for (const filePath of candidates) {
    try {
      const config = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
      const baseUrl = typeof config.baseUrl === 'string' ? config.baseUrl : null
      const apiKey = typeof config.apiKey === 'string' ? config.apiKey : null
      if (!baseUrl || !apiKey) continue
      const headers: Record<string, string> = { 'X-Z-AI-From': 'Z' }
      if (typeof config.chatId === 'string') headers['X-Chat-Id'] = config.chatId
      if (typeof config.userId === 'string') headers['X-User-Id'] = config.userId
      if (typeof config.token === 'string') headers['X-Token'] = config.token
      return { baseUrl, apiKey, headers }
    } catch {
      // Missing or malformed file — try the next candidate.
    }
  }
  return null
}

export function resolveAiProvider(): { provider: ZaiProvider | null; mode: AiMode } {
  if (cached) return cached

  const envKey = process.env.ZAI_API_KEY
  if (typeof envKey === 'string' && envKey.trim().length > 0) {
    // Production path: public Z.AI endpoint with the key passed explicitly.
    // The sandbox gateway below is intentionally unreachable from this mode.
    cached = { provider: createZai({ apiKey: envKey.trim() }), mode: 'live-zai-api' }
  } else {
    const gateway = loadSandboxGatewayConfig()
    cached = gateway
      ? {
          provider: createZai({
            baseURL: gateway.baseUrl,
            apiKey: gateway.apiKey,
            headers: gateway.headers,
          }),
          mode: 'live-sandbox-gateway',
        }
      : { provider: null, mode: 'mock' }
  }
  return cached
}

/* ------------------------------- Mock fallback ----------------------------- */

const URGENT_HINTS = /\b(urgent|asap|today|eod|outage|production (is )?down|sev[- ]?[12]|blocker|critical)\b/i
const HIGH_HINTS = /\b(bug|broken|crash|error|fail(s|ed|ing)?|dead|stuck|cannot|can'?t|blocked|regression|security|data loss)\b/i
const LOW_HINTS = /\b(nice to have|maybe|consider|idea|someday|later|polish|cleanup|refactor|doc(s|umentation)?|chore)\b/i

function guessPriority(rawInput: string): IssuePriority {
  if (URGENT_HINTS.test(rawInput)) return 'URGENT'
  if (HIGH_HINTS.test(rawInput)) return 'HIGH'
  if (LOW_HINTS.test(rawInput)) return 'LOW'
  return 'MEDIUM'
}

function deriveTitle(rawInput: string): string {
  const firstLine = rawInput
    .split('\n')
    .map((line) => line.replace(/^[-*#\s]+/, '').trim())
    .find((line) => line.length > 0)
  const source = firstLine ?? rawInput.trim()
  const cleaned = source
    .replace(/^(rough note|note|idea|issue|task)\s*[:\-]\s*/i, '')
    .replace(/[.?!]+$/, '')
  if (cleaned.length <= 80) {
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
  }
  const cut = cleaned.slice(0, 80)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim() + '…'
}

/**
 * Deterministic offline stand-in for a live GLM call. Produces the exact
 * same shape as the real pipeline so the Create Issue dialog can be
 * exercised end-to-end without any model backend.
 */
export function mockEnhancement(rawInput: string): EnhancedIssue {
  const context = rawInput.trim().slice(0, 240)
  return {
    title: deriveTitle(rawInput),
    description: [
      '## Context',
      '',
      context,
      '',
      '## Acceptance Criteria',
      '',
      '- Reproduce the reported behavior on the latest build and document the exact steps.',
      '- Implement the change described above with a focused, reviewable diff.',
      '- Verify the affected flow manually and confirm the acceptance criteria hold.',
      '- Add or update a regression check so this cannot silently come back.',
    ].join('\n'),
    priority: guessPriority(rawInput),
  }
}

/* --------------------------- Output salvage helper ------------------------- */

/** Removes ```json fences some models wrap their answer in. */
export function stripJsonFence(text: string): string {
  const trimmed = text.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed)
  return fenced ? fenced[1].trim() : trimmed
}

/**
 * The sandbox gateway does not support JSON-schema response formats, so the
 * model occasionally drifts from the schema and the SDK throws
 * AI_NoObjectGeneratedError. The raw completion text rides along on that
 * error — parse and validate it manually before giving up on a live answer.
 */
export function salvageEnhancedIssue(error: unknown): EnhancedIssue | null {
  const raw = (error as { text?: unknown } | null)?.text
  if (typeof raw !== 'string') return null
  try {
    const parsed = enhancedIssueSchema.safeParse(JSON.parse(stripJsonFence(raw)))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
