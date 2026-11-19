'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Loader2, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { createIssueAction } from '@/server/actions/issue'
import { useAction } from '@/components/app/use-action'
import {
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  PRIORITY_LABELS,
  STATUS_LABELS,
  type EnhanceIssueResponse,
  type IssuePriority,
  type IssueStatus,
  type MemberInfo,
} from '@/lib/types'

interface CreateIssueDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  members: MemberInfo[]
  defaultStatus: IssueStatus
}

export function CreateIssueDialog({
  open,
  onOpenChange,
  projectId,
  members,
  defaultStatus,
}: CreateIssueDialogProps) {
  const queryClient = useQueryClient()
  const { run, isPending } = useAction()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<IssueStatus>(defaultStatus)
  const [priority, setPriority] = useState<IssuePriority>('MEDIUM')
  const [assigneeId, setAssigneeId] = useState<string>('unassigned')
  const [enhancing, setEnhancing] = useState(false)
  const [aiMockNotice, setAiMockNotice] = useState<string | null>(null)

  function reset() {
    setTitle('')
    setDescription('')
    setStatus(defaultStatus)
    setPriority('MEDIUM')
    setAssigneeId('unassigned')
    setEnhancing(false)
    setAiMockNotice(null)
  }

  /**
   * Sends the current title/notes to /api/ai/enhance-issue and fills the
   * form fields with the structured GLM response. The server degrades to a
   * deterministic mock when no model backend is configured; `mock: true`
   * flips an in-dialog banner instead of failing.
   */
  async function handleEnhance() {
    const rawInput = [title.trim(), description.trim()].filter(Boolean).join('\n\n')
    if (rawInput.length < 3) {
      toast.error('Add a title or a few notes first — the AI needs something to work with.')
      return
    }
    setEnhancing(true)
    setAiMockNotice(null)
    try {
      const response = await fetch('/api/ai/enhance-issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawInput }),
      })
      const payload = (await response.json().catch(() => null)) as EnhanceIssueResponse | null
      const errorMessage = payload && !payload.success ? payload.error : undefined
      if (!response.ok || !payload?.success || !payload.data) {
        toast.error(errorMessage ?? 'AI enhancement failed. Please try again.')
        return
      }
      // Smoothly fill the form with the structured suggestions.
      setTitle(payload.data.title.slice(0, 140))
      setDescription(payload.data.description.slice(0, 2000))
      setPriority(payload.data.priority)
      if (payload.mock) {
        setAiMockNotice(
          'Mock mode: no AI backend is configured (set ZAI_API_KEY in your environment variables), so a deterministic placeholder was filled in instead of live GLM output.',
        )
      } else {
        toast.success('Fields enhanced with AI')
      }
    } catch {
      toast.error('Could not reach the server for AI enhancement.')
    } finally {
      setEnhancing(false)
    }
  }

  async function handleCreate() {
    const data = await run(
      'create-issue',
      () =>
        createIssueAction({
          projectId,
          title: title.trim(),
          description: description.trim() || undefined,
          status,
          priority,
          assigneeId: assigneeId === 'unassigned' ? null : assigneeId,
        }),
      { successMessage: 'Issue created' },
    )
    if (data) {
      void queryClient.invalidateQueries({ queryKey: ['board', projectId] })
      onOpenChange(false)
      reset()
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New issue</DialogTitle>
          <DialogDescription>Issues land in the selected column of this board.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {aiMockNotice ? (
            <div
              role="status"
              className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
            >
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="flex-1 leading-relaxed">{aiMockNotice}</span>
              <button
                type="button"
                onClick={() => setAiMockNotice(null)}
                className="shrink-0 rounded p-0.5 hover:bg-amber-100 dark:hover:bg-amber-900"
                aria-label="Dismiss notice"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="issue-title">Title</Label>
            <Input
              id="issue-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Short, actionable summary"
              maxLength={140}
              autoFocus
              onKeyDown={(event) => {
                if (event.key === 'Enter' && title.trim().length >= 2) {
                  void handleCreate()
                }
              }}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="issue-description">Description (optional)</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs text-violet-600 hover:text-violet-700 dark:text-violet-400"
                disabled={enhancing || isPending('create-issue')}
                onClick={() => void handleEnhance()}
              >
                {enhancing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" aria-hidden />
                )}
                {enhancing ? 'Enhancing…' : 'Enhance with AI'}
              </Button>
            </div>
            <Textarea
              id="issue-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Context, acceptance criteria, links…"
              rows={4}
              maxLength={2000}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="issue-status">Status</Label>
              <Select value={status} onValueChange={(value) => setStatus(value as IssueStatus)}>
                <SelectTrigger id="issue-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ISSUE_STATUSES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {STATUS_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="issue-priority">Priority</Label>
              <Select value={priority} onValueChange={(value) => setPriority(value as IssuePriority)}>
                <SelectTrigger id="issue-priority" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ISSUE_PRIORITIES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {PRIORITY_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="issue-assignee">Assignee</Label>
              <Select value={assigneeId} onValueChange={setAssigneeId}>
                <SelectTrigger id="issue-assignee" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {members.map((member) => (
                    <SelectItem key={member.userId} value={member.userId}>
                      {member.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={title.trim().length < 2 || isPending('create-issue')} onClick={() => void handleCreate()}>
            {isPending('create-issue') ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Create issue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
