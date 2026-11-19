import { NextResponse } from 'next/server'
import { generateText, Output } from 'ai'
import { auth } from '@/lib/session'
import { enhanceIssueSchema, enhancedIssueSchema } from '@/lib/validations/ai'
import {
  AI_MODEL_ID,
  mockEnhancement,
  resolveAiProvider,
  salvageEnhancedIssue,
} from '@/server/ai'

/**
 * AI Issue Assistant endpoint (POST /api/ai/enhance-issue).
 *
 * Pipeline: auth() gate -> Zod request validation -> structured generation
 * with `zai('glm-5.3-flash')` via the Vercel AI SDK -> Zod-validated
 * `{ title, description, priority }` payload.
 *
 * Degradation ladder (the UI must stay testable without crashing):
 *   structured output  ->  raw-text salvage  ->  deterministic mock
 * `mock: true` in the response tells the client to show the "mock mode"
 * banner instead of claiming a live model answer.
 */

const ENHANCE_SYSTEM_PROMPT = [
  'You are the issue-tracker assistant for a software team.',
  'Transform the user\'s rough note into a crisp, actionable issue.',
  'Rules:',
  '- title: imperative mood, no trailing period, at most 80 characters.',
  '- description: GitHub-flavored Markdown with exactly two sections,',
  '  "## Context" (2-3 sentences of background, infer intent from the note)',
  '  and "## Acceptance Criteria" (3-5 items, each starting with "- ").',
  '- priority: exactly one of LOW, MEDIUM, HIGH, URGENT (uppercase),',
  '  judged from urgency signals in the note.',
  'Respond with JSON only, no prose around it.',
].join('\n')

export async function POST(request: Request) {
  // 1. Authentication gate — the assistant is a signed-in feature.
  const session = await auth()
  if (!session) {
    return NextResponse.json(
      { success: false, error: 'You must be signed in to use the AI assistant.' },
      { status: 401 },
    )
  }

  // 2. Request validation — empty/whitespace prompts never reach the model.
  let body: unknown = null
  try {
    body = await request.json()
  } catch {
    body = null
  }
  const parsed = enhanceIssueSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' },
      { status: 400 },
    )
  }
  const { rawInput } = parsed.data

  // 3. Model backend — mock mode short-circuits before any network call.
  const { provider, mode } = resolveAiProvider()
  if (!provider) {
    return NextResponse.json({ success: true, data: mockEnhancement(rawInput), mock: true })
  }

  // 4. Structured generation. `Output.object` is the AI SDK v7 replacement
  //    for the deprecated generateObject; the schema lives in
  //    src/lib/validations/ai.ts and normalises model quirks.
  try {
    const { output } = await generateText({
      model: provider(AI_MODEL_ID),
      output: Output.object({ schema: enhancedIssueSchema }),
      system: ENHANCE_SYSTEM_PROMPT,
      prompt: `Rough note from the team member:\n\n${rawInput}`,
      abortSignal: AbortSignal.timeout(45_000),
    })
    return NextResponse.json({ success: true, data: output, mock: false })
  } catch (error) {
    // 5. Salvage: keep a live answer whose formatting merely drifted.
    const salvaged = salvageEnhancedIssue(error)
    if (salvaged) {
      return NextResponse.json({ success: true, data: salvaged, mock: false })
    }
    console.error(
      `[ai/enhance-issue] ${mode} call failed, serving mock fallback:`,
      error instanceof Error ? error.message : error,
    )
    return NextResponse.json({ success: true, data: mockEnhancement(rawInput), mock: true })
  }
}
