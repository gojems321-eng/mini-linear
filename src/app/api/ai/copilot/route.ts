import { NextResponse } from 'next/server'
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  type UIMessage,
} from 'ai'
import { auth } from '@/lib/session'
import { db } from '@/lib/db'
import { copilotChatSchema } from '@/lib/validations/ai'
import { createWorkspaceTools } from '@/lib/ai/workspace-tools'
import { AI_MODEL_ID, resolveAiProvider } from '@/server/ai'

/**
 * Agentic Workspace Copilot endpoint (POST /api/ai/copilot).
 *
 * Pipeline: auth() gate -> request schema (workspaceId + UIMessages) ->
 * workspace membership check -> streamText with `groq(AI_MODEL_ID)` (default
 * llama-3.3-70b-versatile, overridable via GROQ_MODEL) and
 * the three RBAC-scoped Prisma tools.
 *
 * `stopWhen: stepCountIs(5)` is the AI SDK v7 replacement for
 * `maxSteps: 5`: the agent may chain up to five tool-call/result steps
 * (call tool -> read DB rows -> call another tool -> ...) before composing
 * its final answer.
 *
 * Fallback ladder (mirrors the Issue Assistant): GROQ_API_KEY -> a helpful
 * static message streamed as a normal UIMessage so the drawer keeps working
 * end-to-end without a model backend.
 */

const COPILOT_FALLBACK_MESSAGE =
  'The Copilot cannot reach its AI backend right now. Set GROQ_API_KEY in your ' +
  'deployment environment variables and try again. ' +
  'Everything else in Mini-Linear keeps working — boards, issues and members are unaffected.'

function fallbackStreamResponse() {
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      writer.write({ type: 'text-start', id: 'copilot-fallback' })
      writer.write({ type: 'text-delta', id: 'copilot-fallback', delta: COPILOT_FALLBACK_MESSAGE })
      writer.write({ type: 'text-end', id: 'copilot-fallback' })
    },
  })
  return createUIMessageStreamResponse({ stream })
}

export async function POST(request: Request) {
  // 1. Authentication gate.
  const session = await auth()
  if (!session) {
    return NextResponse.json(
      { success: false, error: 'You must be signed in to use the Copilot.' },
      { status: 401 },
    )
  }

  // 2. Request validation: active workspace id + UI message history.
  let body: unknown = null
  try {
    body = await request.json()
  } catch {
    body = null
  }
  const parsed = copilotChatSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid request.' },
      { status: 400 },
    )
  }
  const { workspaceId } = parsed.data

  // 3. RBAC: the caller must be a member of the requested workspace.
  const membership = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: session.userId } },
    select: { id: true },
  })
  if (!membership) {
    return NextResponse.json(
      { success: false, error: 'You do not have access to this workspace.' },
      { status: 403 },
    )
  }

  // 4. Model backend — mock tier streams the helpful static message.
  const { provider, mode } = resolveAiProvider()
  if (!provider) {
    return fallbackStreamResponse()
  }

  const workspaceName = (
    await db.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } })
  )?.name

  const tools = createWorkspaceTools({ userId: session.userId, workspaceId })

  try {
    const result = streamText({
      model: provider(AI_MODEL_ID),
      system: [
        'You are the Workspace Copilot for Mini-Linear, a kanban issue tracker.',
        `The signed-in member is asking about the "${workspaceName ?? 'current'}" workspace.`,
        '',
        'Rules:',
        '- Always use tools for facts about the workspace. Never guess issue counts, member names, project ids or states.',
        '- Call getWorkspaceSummary first for broad questions (status reports, workload overviews) and before creating an issue, to learn valid project ids.',
        '- searchIssues filters by keyword (title/description), status, priority or assignee name; combine filters freely.',
        '- To create an issue: pick a valid projectId from getWorkspaceSummary, write a crisp imperative title, and set a sensible priority from the request. createIssueTool accepts an optional assigneeName; if it reports that member was not found, retry without an assignee instead of asking again.',
        '- This workspace has no due dates. If asked about overdue work, say so and offer the urgent open issues instead.',
        '- Keep answers short and scannable (short paragraphs or bullet lists). After creating an issue, confirm title, project, status and priority in one line.',
      ].join('\n'),
      messages: await convertToModelMessages(parsed.data.messages as unknown as UIMessage[]),
      tools,
      stopWhen: stepCountIs(5),
      abortSignal: request.signal,
    })
    return result.toUIMessageStreamResponse({
      onError: (error) => {
        console.error(
          `[ai/copilot] ${mode} stream failed:`,
          error instanceof Error ? error.message : error,
        )
        return 'The Copilot hit an error talking to the AI backend. Please try again in a moment.'
      },
    })
  } catch (error) {
    console.error(
      `[ai/copilot] ${mode} request failed:`,
      error instanceof Error ? error.message : error,
    )
    return fallbackStreamResponse()
  }
}
