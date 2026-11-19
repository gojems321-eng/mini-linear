'use client'

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNowStrict } from 'date-fns'
import {
  ArrowRight,
  Check,
  History,
  Loader2,
  Pencil,
  Send,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { avatarColorFor, initialsFor } from '@/lib/types'
import {
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  PRIORITY_LABELS,
  STATUS_LABELS,
  type IssuePriority,
  type IssueStatus,
  type MemberInfo,
} from '@/lib/types'
import { getIssueDetail } from '@/server/queries'
import { deleteIssueAction, updateIssueAction } from '@/server/actions/issue'
import { addCommentAction } from '@/server/actions/comment'
import { useAction } from '@/components/app/use-action'

interface IssueDialogProps {
  issueId: string
  members: MemberInfo[]
  onClose: () => void
}

export function IssueDialog({ issueId, members, onClose }: IssueDialogProps) {
  const queryClient = useQueryClient()
  const { run, isPending } = useAction()

  const detailQuery = useQuery({
    queryKey: ['issue', issueId],
    queryFn: () => getIssueDetail(issueId),
    retry: false,
  })

  const projectId = detailQuery.data?.issue.projectId

  // If a teammate deleted this issue while the modal is open, close it.
  useEffect(() => {
    if (detailQuery.isError) {
      toast.error(detailQuery.error instanceof Error ? detailQuery.error.message : 'Issue unavailable')
      onClose()
    }
  }, [detailQuery.isError, detailQuery.error, onClose])

  async function handleUpdate(patch: Record<string, unknown>, message?: string) {
    const data = await run('update-issue', () => updateIssueAction({ issueId, ...patch }), {
      successMessage: message,
    })
    if (data) {
      void queryClient.invalidateQueries({ queryKey: ['issue', issueId] })
      if (projectId) void queryClient.invalidateQueries({ queryKey: ['board', projectId] })
    }
  }

  async function handleDelete() {
    const data = await run('delete-issue', () => deleteIssueAction({ issueId }), {
      successMessage: 'Issue deleted',
    })
    if (data !== null) {
      if (projectId) void queryClient.invalidateQueries({ queryKey: ['board', projectId] })
      onClose()
    }
  }

  const issue = detailQuery.data?.issue

  return (
    <Dialog open onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent className="grid max-h-[90vh] gap-0 overflow-hidden p-0 sm:max-w-3xl sm:grid-cols-[1fr_13rem]">
        <DialogHeader className="sr-only">
          <DialogTitle>Issue details</DialogTitle>
          <DialogDescription>View and edit this issue</DialogDescription>
        </DialogHeader>

        {detailQuery.isPending || !issue ? (
          <div className="col-span-full space-y-3 p-6">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <>
            {/* Main column: title, description, timeline */}
            <div className="flex min-h-0 flex-col">
              <div className="space-y-4 p-5 pb-3">
                <TitleEditor
                  title={issue.title}
                  onSubmit={(title) => void handleUpdate({ title }, 'Title updated')}
                  pending={isPending('update-issue')}
                />
                <DescriptionEditor
                  description={issue.description}
                  onSubmit={(description) => void handleUpdate({ description }, 'Description updated')}
                  pending={isPending('update-issue')}
                />
              </div>

              <Separator />

              <TimelineSection
                issueId={issueId}
                timeline={detailQuery.data?.timeline ?? []}
                onSubmitComment={async (body) => {
                  const data = await run('add-comment', () => addCommentAction({ issueId, body }), {
                    successMessage: 'Comment added',
                  })
                  if (data) {
                    void queryClient.invalidateQueries({ queryKey: ['issue', issueId] })
                    if (projectId) void queryClient.invalidateQueries({ queryKey: ['board', projectId] })
                  }
                  return data !== null
                }}
                commentPending={isPending('add-comment')}
              />
            </div>

            {/* Side rail: properties + danger zone */}
            <aside className="flex flex-col gap-4 border-t bg-muted/30 p-4 sm:border-l sm:border-t-0">
              <div className="space-y-1.5">
                <Label htmlFor="detail-status">Status</Label>
                <Select
                  value={issue.status}
                  onValueChange={(value) =>
                    void handleUpdate({ status: value as IssueStatus }, 'Status updated')
                  }
                >
                  <SelectTrigger id="detail-status" className="w-full bg-background">
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

              <div className="space-y-1.5">
                <Label htmlFor="detail-priority">Priority</Label>
                <Select
                  value={issue.priority}
                  onValueChange={(value) =>
                    void handleUpdate({ priority: value as IssuePriority }, 'Priority updated')
                  }
                >
                  <SelectTrigger id="detail-priority" className="w-full bg-background">
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

              <div className="space-y-1.5">
                <Label htmlFor="detail-assignee">Assignee</Label>
                <Select
                  value={issue.assignee?.userId ?? 'unassigned'}
                  onValueChange={(value) =>
                    void handleUpdate(
                      { assigneeId: value === 'unassigned' ? null : value },
                      'Assignee updated',
                    )
                  }
                >
                  <SelectTrigger id="detail-assignee" className="w-full bg-background">
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

              <div className="mt-auto space-y-2 pt-4">
                <p className="text-[11px] text-muted-foreground">
                  Created by {issue.createdBy.name}
                </p>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" className="w-full text-destructive hover:text-destructive">
                      <Trash2 className="h-4 w-4" aria-hidden />
                      Delete issue
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this issue?</AlertDialogTitle>
                      <AlertDialogDescription>
                        “{issue.title}” and its comments will be permanently removed.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-white hover:bg-destructive/90"
                        onClick={() => void handleDelete()}
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </aside>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------ Title editor ------------------------------ */

function TitleEditor({
  title,
  onSubmit,
  pending,
}: {
  title: string
  onSubmit: (title: string) => void
  pending: boolean
}) {
  /** null = not editing; a string = draft while editing. */
  const [draft, setDraft] = useState<string | null>(null)
  const editing = draft !== null

  if (editing) {
    return (
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={140}
          autoFocus
          aria-label="Issue title"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && draft.trim().length >= 2) {
              onSubmit(draft.trim())
              setDraft(null)
            }
            if (event.key === 'Escape') setDraft(null)
          }}
        />
        <Button
          size="icon"
          aria-label="Save title"
          disabled={draft.trim().length < 2 || pending}
          onClick={() => {
            onSubmit(draft.trim())
            setDraft(null)
          }}
        >
          <Check className="h-4 w-4" aria-hidden />
        </Button>
        <Button size="icon" variant="outline" aria-label="Cancel title edit" onClick={() => setDraft(null)}>
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    )
  }

  return (
    <div className="group flex items-start justify-between gap-2">
      <h2 className="text-lg font-semibold leading-snug tracking-tight">{title}</h2>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 shrink-0 p-0 opacity-60 group-hover:opacity-100"
        aria-label="Edit title"
        onClick={() => setDraft(title)}
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden />
      </Button>
    </div>
  )
}

/* --------------------------- Description editor --------------------------- */

function DescriptionEditor({
  description,
  onSubmit,
  pending,
}: {
  description: string | null
  onSubmit: (description: string | null) => void
  pending: boolean
}) {
  /** null = not editing; a string = draft while editing. */
  const [draft, setDraft] = useState<string | null>(null)
  const editing = draft !== null

  if (editing) {
    return (
      <div className="space-y-2">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={4}
          maxLength={2000}
          placeholder="Add context, acceptance criteria, links…"
          aria-label="Issue description"
          autoFocus
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={pending}
            onClick={() => {
              onSubmit(draft.trim().length > 0 ? draft.trim() : null)
              setDraft(null)
            }}
          >
            Save
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDraft(null)}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setDraft(description ?? '')}
      className="w-full rounded-md border border-dashed bg-muted/20 p-3 text-left text-sm text-muted-foreground transition-colors hover:border-foreground/25"
      aria-label="Edit description"
    >
      {description ?? 'Add a description…'}
    </button>
  )
}

/* -------------------------------- Timeline -------------------------------- */

const ACTIVITY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  ISSUE_CREATED: UserPlus,
  STATUS_CHANGED: ArrowRight,
  PRIORITY_CHANGED: History,
  ASSIGNEE_CHANGED: UserPlus,
  TITLE_UPDATED: Pencil,
  DESCRIPTION_UPDATED: Pencil,
}

function TimelineSection({
  issueId,
  timeline,
  onSubmitComment,
  commentPending,
}: {
  issueId: string
  timeline: {
    id: string
    kind: 'comment' | 'activity'
    body: string
    activityType: string | null
    actorId: string
    actorName: string
    createdAt: string
  }[]
  onSubmitComment: (body: string) => Promise<boolean>
  commentPending: boolean
}) {
  const [draft, setDraft] = useState('')

  async function submit() {
    const body = draft.trim()
    if (body.length === 0) return
    const success = await onSubmitComment(body)
    if (success) setDraft('')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-5 pt-3 pb-2">
        <History className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h3 className="text-sm font-medium">Activity &amp; comments</h3>
        <span className="text-xs text-muted-foreground">{timeline.length}</span>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-5">
        <ul className="space-y-3 pb-3">
          {timeline.map((entry) =>
            entry.kind === 'comment' ? (
              <li key={entry.id} className="flex gap-2.5">
                <Avatar className="h-6 w-6 shrink-0">
                  <AvatarFallback className={cn('text-[10px] text-white', avatarColorFor(entry.actorId))}>
                    {initialsFor(entry.actorName)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1 rounded-lg border bg-muted/30 px-3 py-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-medium">{entry.actorName}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {formatDistanceToNowStrict(new Date(entry.createdAt), { addSuffix: true })}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm">{entry.body}</p>
                </div>
              </li>
            ) : (
              <li key={entry.id} className="flex items-center gap-2 pl-1 text-xs text-muted-foreground">
                {(() => {
                  const Icon = ACTIVITY_ICONS[entry.activityType ?? ''] ?? History
                  return <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                })()}
                <span>{entry.body}</span>
                <span className="ml-auto shrink-0 text-[10px]">
                  {formatDistanceToNowStrict(new Date(entry.createdAt), { addSuffix: true })}
                </span>
              </li>
            ),
          )}
          {timeline.length === 0 ? (
            <li className="py-6 text-center text-xs text-muted-foreground">
              No activity yet. Comments and changes will show up here in real time.
            </li>
          ) : null}
        </ul>
      </ScrollArea>

      <div className="border-t p-4">
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Write a comment…"
            rows={2}
            maxLength={2000}
            aria-label={`Comment on issue ${issueId}`}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void submit()
              }
            }}
          />
          <Button type="submit" size="icon" disabled={draft.trim().length === 0 || commentPending} aria-label="Send comment">
            {commentPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Send className="h-4 w-4" aria-hidden />
            )}
          </Button>
        </form>
      </div>
    </div>
  )
}
