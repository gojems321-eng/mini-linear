'use client'

import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Circle, CircleDot, CircleDashed, CircleCheck, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { SortableIssueCard, IssueCardOverlay } from '@/components/app/issue-card'
import { moveIssueAction } from '@/server/actions/issue'
import { cn } from '@/lib/utils'
import {
  STATUS_LABELS,
  STATUS_ORDER,
  type BoardData,
  type IssueDTO,
  type IssueStatus,
} from '@/lib/types'

const STATUS_ICONS: Record<IssueStatus, React.ComponentType<{ className?: string }>> = {
  BACKLOG: CircleDashed,
  TODO: Circle,
  IN_PROGRESS: CircleDot,
  DONE: CircleCheck,
}

interface BoardProps {
  board: BoardData
  onOpenIssue: (issueId: string) => void
  onCreateIssue: (status: IssueStatus) => void
}

export function Board({ board, onOpenIssue, onCreateIssue }: BoardProps) {
  const queryClient = useQueryClient()
  const [draggingIssue, setDraggingIssue] = useState<IssueDTO | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const columns = useMemo(() => {
    const grouped = new Map<IssueStatus, IssueDTO[]>()
    for (const status of STATUS_ORDER) grouped.set(status, [])
    // Server already orders by position asc; the flat array's per-status
    // relative order is the column order.
    for (const issue of board.issues) {
      grouped.get(issue.status)?.push(issue)
    }
    return grouped
  }, [board.issues])

  function handleDragStart(event: DragStartEvent) {
    const issue = board.issues.find((i) => i.id === String(event.active.id))
    setDraggingIssue(issue ?? null)
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggingIssue(null)
    const { active, over } = event
    if (!over) return

    const activeId = String(active.id)
    const overId = String(over.id)
    const activeIssue = board.issues.find((i) => i.id === activeId)
    if (!activeIssue || activeId === overId) return

    const overIsColumn = (STATUS_ORDER as readonly string[]).includes(overId)
    const overStatus: IssueStatus | undefined = overIsColumn
      ? (overId as IssueStatus)
      : ((over.data.current?.status as IssueStatus | undefined) ??
        board.issues.find((i) => i.id === overId)?.status)
    if (!overStatus) return

    // Source column (original order, including the dragged card).
    const sourceColumn = board.issues.filter((i) => i.status === activeIssue.status)
    const originalActiveIndex = sourceColumn.findIndex((i) => i.id === activeId)

    // Destination column excluding the dragged card — this matches the
    // server's splice semantics (insert at index among the others).
    const destOthers = board.issues.filter((i) => i.status === overStatus && i.id !== activeId)

    let index: number
    if (overIsColumn) {
      index = destOthers.length
    } else {
      const overIndex = destOthers.findIndex((i) => i.id === overId)
      if (overIndex < 0) {
        index = destOthers.length
      } else if (activeIssue.status === overStatus && originalActiveIndex < overIndex + 1) {
        // Moving down within the same column lands after the hovered card.
        index = overIndex + 1
      } else {
        index = overIndex
      }
    }

    const sameSpot =
      activeIssue.status === overStatus && sourceColumn.findIndex((i) => i.id === activeId) === index
    if (sameSpot) return

    // Optimistic reorder, then reconcile with the server's authoritative
    // fractional positions.
    const queryKey = ['board', board.project.id] as const
    queryClient.setQueryData<BoardData>(queryKey, (old) => {
      if (!old) return old
      const others = old.issues.filter((i) => i.id !== activeId)
      const moved: IssueDTO = { ...activeIssue, status: overStatus }
      return {
        ...old,
        issues: STATUS_ORDER.flatMap((status) => {
          const column = others.filter((i) => i.status === status)
          if (status !== overStatus) return column
          const clamped = Math.max(0, Math.min(index, column.length))
          const next = [...column]
          next.splice(clamped, 0, moved)
          return next
        }),
      }
    })

    void (async () => {
      const result = await moveIssueAction({ issueId: activeId, status: overStatus, index })
      if (!result.ok) {
        toast.error(result.error)
      }
      void queryClient.invalidateQueries({ queryKey })
    })()
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b bg-background px-4 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">{board.project.name}</h1>
          {board.project.description ? (
            <p className="truncate text-sm text-muted-foreground">{board.project.description}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {board.issues.length} {board.issues.length === 1 ? 'issue' : 'issues'}
          </span>
          <Button size="sm" onClick={() => onCreateIssue('TODO')}>
            <Plus className="h-4 w-4" aria-hidden />
            New issue
          </Button>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDraggingIssue(null)}
      >
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-3 py-3 sm:px-4">
          {STATUS_ORDER.map((status) => (
            <BoardColumn
              key={status}
              status={status}
              issues={columns.get(status) ?? []}
              onOpenIssue={onOpenIssue}
              onCreateIssue={onCreateIssue}
            />
          ))}
        </div>

        <DragOverlay>{draggingIssue ? <IssueCardOverlay issue={draggingIssue} /> : null}</DragOverlay>
      </DndContext>
    </div>
  )
}

function BoardColumn({
  status,
  issues,
  onOpenIssue,
  onCreateIssue,
}: {
  status: IssueStatus
  issues: IssueDTO[]
  onOpenIssue: (issueId: string) => void
  onCreateIssue: (status: IssueStatus) => void
}) {
  const Icon = STATUS_ICONS[status]
  return (
    <section
      aria-label={`${STATUS_LABELS[status]} column, ${issues.length} issues`}
      className="flex w-[80vw] shrink-0 flex-col rounded-xl border bg-muted/40 sm:w-72"
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-medium">{STATUS_LABELS[status]}</h2>
        <span className="text-xs text-muted-foreground">{issues.length}</span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 w-7 p-0"
          aria-label={`New issue in ${STATUS_LABELS[status]}`}
          onClick={() => onCreateIssue(status)}
        >
          <Plus className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      <ColumnDropArea status={status} issues={issues} onOpenIssue={onOpenIssue} />
    </section>
  )
}

function ColumnDropArea({
  status,
  issues,
  onOpenIssue,
}: {
  status: IssueStatus
  issues: IssueDTO[]
  onOpenIssue: (issueId: string) => void
}) {
  return (
    <SortableContext items={issues.map((i) => i.id)} strategy={verticalListSortingStrategy}>
      <ol className="flex min-h-[4rem] flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {issues.map((issue) => (
          <li key={issue.id}>
            <SortableIssueCard issue={issue} onOpen={onOpenIssue} />
          </li>
        ))}
        {issues.length === 0 ? (
          <li className="flex h-16 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">
            Drop issues here
          </li>
        ) : null}
      </ol>
    </SortableContext>
  )
}

export function BoardSkeleton() {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-4 py-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="mt-2 h-4 w-72" />
      </div>
      <div className="flex flex-1 gap-3 overflow-hidden px-4 py-3">
        {STATUS_ORDER.map((status) => (
          <div key={status} className="w-72 shrink-0 space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ))}
      </div>
    </div>
  )
}
