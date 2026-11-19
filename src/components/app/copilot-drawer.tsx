'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import { Bot, CircleCheck, CircleX, Loader2, SendHorizontal, Square } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

interface CopilotDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  workspaceName: string | null
}

/** Starter chips shown on an empty thread — one click sends the prompt. */
const STARTER_PROMPTS = [
  'Summarize our urgent bugs',
  'Who has the most tasks right now?',
  'Create a high-priority task to audit API rate limits',
] as const

const TOOL_LABELS: Record<string, string> = {
  'tool-getWorkspaceSummary': 'Checking the workspace',
  'tool-searchIssues': 'Searching issues',
  'tool-createIssueTool': 'Creating an issue',
}

/** Loose shape of a tool part in an untyped UIMessage. */
type LooseToolPart = {
  type: string
  state?: 'input-streaming' | 'input-available' | 'output-available' | 'output-error'
  input?: unknown
  output?: unknown
}

function isCreateIssueSuccess(part: LooseToolPart): boolean {
  const output = part.output as { created?: boolean } | undefined
  return part.state === 'output-available' && output?.created === true
}

export function CopilotDrawer({
  open,
  onOpenChange,
  workspaceId,
  workspaceName,
}: CopilotDrawerProps) {
  const queryClient = useQueryClient()
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/ai/copilot',
        // The route verifies membership against THIS workspace; the model
        // never receives ids from any other source.
        body: { workspaceId },
      }),
    [workspaceId],
  )

  const chat = useChat({
    // Keying the thread per workspace gives every workspace its own history.
    id: `copilot-${workspaceId}`,
    transport,
    onFinish: ({ message }) => {
      // Auto-refresh the board if the agent created an issue this turn.
      const created = message.parts.some(
        (part) => part.type.startsWith('tool-') && isCreateIssueSuccess(part as LooseToolPart),
      )
      if (created) {
        void queryClient.invalidateQueries({ queryKey: ['board'] })
        void queryClient.invalidateQueries({ queryKey: ['workspace'] })
        void queryClient.invalidateQueries({ queryKey: ['workspaces'] })
        toast.success('Copilot created an issue — board refreshed')
      }
    },
    onError: (error) => {
      toast.error(error.message || 'Copilot could not reach the server.')
    },
  })

  const { messages, sendMessage, stop, status } = chat
  const streaming = status === 'submitted' || status === 'streaming'
  const idle = status === 'ready' || status === 'error'

  // Keep the newest message in view while streaming.
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [messages, streaming])

  const submit = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || !idle) return
      setInput('')
      await sendMessage({ text: trimmed })
    },
    [sendMessage, idle],
  )

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="inset-y-0 flex h-full w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="shrink-0 border-b px-4 py-3">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Bot className="h-4 w-4 text-violet-500" aria-hidden />
            Workspace Copilot
            {workspaceName ? (
              <span className="truncate text-xs font-normal text-muted-foreground">
                · {workspaceName}
              </span>
            ) : null}
          </SheetTitle>
          <SheetDescription className="text-xs">
            Ask about issues and workload, or let the Copilot create them.
          </SheetDescription>
        </SheetHeader>

        {/* Message history */}
        <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {messages.length === 0 ? (
            <div className="space-y-2 pt-6">
              <p className="text-center text-sm text-muted-foreground">
                Try one of these to get started
              </p>
              <div className="space-y-2 pt-1">
                {STARTER_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    disabled={streaming}
                    onClick={() => void submit(prompt)}
                    className="w-full rounded-lg border bg-background px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:border-violet-300 hover:bg-violet-50 hover:text-foreground disabled:opacity-50 dark:hover:border-violet-800 dark:hover:bg-violet-950/50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message) => (
              <CopilotMessage key={message.id} message={message} />
            ))
          )}
          {streaming && status === 'submitted' ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              Copilot is thinking…
            </div>
          ) : null}
        </div>

        {/* Composer */}
        <div className="shrink-0 border-t bg-background px-3 py-3">
          <div className="flex items-center gap-2">
            <Input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about your workspace…"
              maxLength={1000}
              disabled={!idle}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void submit(input)
                }
              }}
            />
            {streaming ? (
              <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={stop} aria-label="Stop generating">
                <Square className="h-4 w-4" aria-hidden />
              </Button>
            ) : (
              <Button
                size="icon"
                className="h-9 w-9 shrink-0"
                disabled={input.trim().length === 0}
                onClick={() => void submit(input)}
                aria-label="Send message"
              >
                <SendHorizontal className="h-4 w-4" aria-hidden />
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

/* ------------------------------ Rendering --------------------------------- */

function CopilotMessage({ message }: { message: UIMessage }) {
  const isUser = message.role === 'user'
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[92%] space-y-1.5 rounded-xl px-3 py-2',
          isUser ? 'bg-primary text-primary-foreground' : 'border bg-background',
        )}
      >
        {message.parts.map((part, index) => {
          if (part.type === 'text') {
            if (!part.text.trim()) return null
            return (
              <div
                key={index}
                className={cn(
                  'text-sm leading-relaxed [&_li]:ml-4 [&_li]:list-disc [&_ol>li]:list-decimal [&_p]:my-1 [&_strong]:font-semibold',
                )}
              >
                <ReactMarkdown>{part.text}</ReactMarkdown>
              </div>
            )
          }
          if (part.type.startsWith('tool-')) {
            return <ToolChip key={index} part={part as LooseToolPart} />
          }
          return null
        })}
      </div>
    </div>
  )
}

function ToolChip({ part }: { part: LooseToolPart }) {
  const label = TOOL_LABELS[part.type] ?? 'Working'
  const creation = part.type === 'tool-createIssueTool' && isCreateIssueSuccess(part)

  let icon = <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
  let tone = 'text-muted-foreground'
  let text = label

  if (part.state === 'output-available') {
    if (creation) {
      icon = <CircleCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
      tone = 'text-emerald-700 dark:text-emerald-400'
      text = 'Issue created'
    } else {
      icon = <CircleCheck className="h-3.5 w-3.5 text-slate-400" aria-hidden />
      text = `${label} — done`
    }
  } else if (part.state === 'output-error') {
    icon = <CircleX className="h-3.5 w-3.5 text-red-500" aria-hidden />
    tone = 'text-red-600 dark:text-red-400'
    text = `${label} — failed`
  }

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded-md border border-dashed bg-muted/40 px-2 py-1 text-xs',
        tone,
      )}
      aria-live="polite"
    >
      {icon}
      <span>{text}</span>
    </div>
  )
}
