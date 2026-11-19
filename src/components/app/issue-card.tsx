'use client'

import { MessageSquare } from 'lucide-react'
import type { DraggableAttributes } from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  avatarColorFor,
  initialsFor,
  PRIORITY_LABELS,
  PRIORITY_STYLES,
  STATUS_LABELS,
  type IssueDTO,
  type IssueStatus,
} from '@/lib/types'

interface IssueCardProps {
  issue: IssueDTO
  onOpen: (issueId: string) => void
}

export function SortableIssueCard({ issue, onOpen }: IssueCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: issue.id,
    data: { status: issue.status satisfies IssueStatus },
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(isDragging && 'opacity-40')}
    >
      <IssueCardBody issue={issue} onOpen={onOpen} listeners={listeners} attributes={attributes} />
    </div>
  )
}

export function IssueCardOverlay({ issue }: { issue: IssueDTO }) {
  return (
    <div className="w-72 rotate-2 shadow-lg">
      <IssueCardBody issue={issue} onOpen={() => undefined} />
    </div>
  )
}

function IssueCardBody({
  issue,
  onOpen,
  listeners,
  attributes,
}: IssueCardProps & {
  listeners?: Record<string, unknown>
  attributes?: DraggableAttributes
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(issue.id)}
      className={cn(
        'block w-full cursor-grab touch-none rounded-lg border bg-card p-3 text-left shadow-sm transition-colors hover:border-foreground/25 active:cursor-grabbing',
      )}
      {...attributes}
      {...listeners}
      aria-label={`${issue.title}. Status: ${STATUS_LABELS[issue.status]}. Priority: ${PRIORITY_LABELS[issue.priority]}`}
    >
      <div className="flex items-center gap-1.5 pb-1.5">
        <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0 font-medium border-0', PRIORITY_STYLES[issue.priority])}>
          {PRIORITY_LABELS[issue.priority]}
        </Badge>
        {issue.commentCount > 0 ? (
          <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
            <MessageSquare className="h-3 w-3" aria-hidden />
            {issue.commentCount}
          </span>
        ) : null}
      </div>
      <p className="text-sm leading-snug">{issue.title}</p>
      {issue.assignee ? (
        <div className="flex items-center gap-2 pt-2">
          <Avatar className="h-5 w-5">
            <AvatarFallback className={cn('text-[9px] text-white', avatarColorFor(issue.assignee.userId))}>
              {initialsFor(issue.assignee.name)}
            </AvatarFallback>
          </Avatar>
          <span className="truncate text-[11px] text-muted-foreground">{issue.assignee.name}</span>
        </div>
      ) : null}
    </button>
  )
}
