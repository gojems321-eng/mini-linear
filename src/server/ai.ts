import 'server-only'

import { createGroq, type GroqProvider } from '@ai-sdk/groq'
import { enhancedIssueSchema } from '@/lib/validations/ai'
import type { EnhancedIssue, IssuePriority } from '@/lib/types'

/**
 * AI backend resolution for the Issue Assistant and Workspace Copilot.
 *
 * The Vercel AI SDK talks to Groq through `@ai-sdk/groq` using
 * `groq(AI_MODEL_ID)` (default: llama-3.3-70b-versatile, overridable via the
 * GROQ_MODEL environment variable). Two environments are supported, resolved
 * once and cached:
 *
 *   1. live-groq   — GROQ_API_KEY is present. The provider talks to Groq's
 *                    OpenAI-compatible API with the key passed explicitly.
 *   2. mock        — no key: `resolveAiProvider` returns null and callers
 *                    fall back to `mockEnhancement` so the UI stays testable.
 */

export const AI_MODEL_ID = process.env.GROQ_MODEL?.trim() || 'llama-3.3-70b-versatile'

export type AiMode = 'live-groq' | 'mock'

let cached: { provider: GroqProvider | null; mode: AiMode } | undefined

export function resolveAiProvider(): { provider: GroqProvider | null; mode: AiMode } {
  if (cached) return cached

  const envKey = process.env.GROQ_API_KEY
  if (typeof envKey === 'string' && envKey.trim().length > 0) {
    // Live path: Groq's API with the key passed explicitly.
    cached = { provider: createGroq({ apiKey: envKey.trim() }), mode: 'live-groq' }
  } else {
    cached = { provider: null, mode: 'mock' }
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
 * Deterministic offline stand-in for a live Groq call. Produces the exact
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
 * Groq models can drift from the requested JSON shape (and unsupported
 * models reject json_schema response formats outright), in which case the
 * SDK throws AI_NoObjectGeneratedError. The raw completion text rides along
 * on that error — parse and validate it manually before giving up on a live
 * answer.
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
