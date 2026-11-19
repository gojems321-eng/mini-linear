'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, ChevronRight, KanbanSquare, Menu, Plus, RefreshCcw, Wifi, WifiOff } from 'lucide-react'
import { toast } from 'sonner'
import { Board, BoardSkeleton } from '@/components/app/board'
import { CopilotDrawer } from '@/components/app/copilot-drawer'
import { CreateIssueDialog } from '@/components/app/create-issue-dialog'
import { IssueDialog } from '@/components/app/issue-dialog'
import { SidebarContent } from '@/components/app/sidebar'
import { WorkspaceOverview } from '@/components/app/workspace-overview'
import { WorkspaceSettingsView } from '@/components/app/workspace-settings-view'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { getRealtimeSocket } from '@/lib/socket-client'
import { createWorkspaceAction } from '@/server/actions/workspace'
import { getBoard, getWorkspaceDetail, listWorkspaces } from '@/server/queries'
import type { IssueStatus, IssueSyncEvent, SessionUser, WorkspaceSummary } from '@/lib/types'

interface AppShellProps {
  sessionUser: SessionUser
  initialWorkspaces: WorkspaceSummary[]
}

export function AppShell({ sessionUser, initialWorkspaces }: AppShellProps) {
  const queryClient = useQueryClient()

  // Requested selections may go stale (workspace deleted, project switched,
  // teammate deleted a project) — the effective active ids are derived below
  // from fresh server data instead of synced with effects.
  const [requestedWorkspaceId, setRequestedWorkspaceId] = useState<string | null>(
    initialWorkspaces[0]?.id ?? null,
  )
  const [requestedProjectId, setRequestedProjectId] = useState<string | null>(null)
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null)
  const [createIssueOpen, setCreateIssueOpen] = useState(false)
  const [createIssueStatus, setCreateIssueStatus] = useState<IssueStatus>('TODO')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [copilotOpen, setCopilotOpen] = useState(false)
  const [realtimeConnected, setRealtimeConnected] = useState(false)

  const selectedIssueRef = useRef<string | null>(null)
  useEffect(() => {
    selectedIssueRef.current = selectedIssueId
  }, [selectedIssueId])

  const workspacesQuery = useQuery({
    queryKey: ['workspaces'],
    queryFn: listWorkspaces,
    initialData: initialWorkspaces,
  })

  // Effective selections derived from fresh server data: a requested id that
  // no longer exists (deleted workspace/project) falls back gracefully.
  const workspaces = workspacesQuery.data ?? []
  const activeWorkspaceId = workspaces.some((w) => w.id === requestedWorkspaceId)
    ? requestedWorkspaceId
    : (workspaces[0]?.id ?? null)

  const workspaceDetailQuery = useQuery({
    queryKey: ['workspace', activeWorkspaceId],
    queryFn: () => getWorkspaceDetail(activeWorkspaceId as string),
    enabled: activeWorkspaceId !== null,
  })

  const detail = workspaceDetailQuery.data
  const projects = detail?.projects ?? null
  const activeProjectId =
    projects && projects.length > 0
      ? requestedProjectId && projects.some((p) => p.id === requestedProjectId)
        ? requestedProjectId
        : projects[0].id
      : null

  const boardQuery = useQuery({
    queryKey: ['board', activeProjectId],
    queryFn: () => getBoard(activeProjectId as string),
    enabled: activeProjectId !== null,
    // If the realtime service is unreachable, fall back to light polling so
    // collaborators' changes still appear (event push resumes when it's back).
    refetchInterval: realtimeConnected ? false : 15_000,
  })

  /* --------------------------- Realtime wiring ---------------------------- */

  useEffect(() => {
    const socket = getRealtimeSocket()
    const update = () => setRealtimeConnected(socket.connected)
    socket.on('connect', update)
    socket.on('disconnect', update)
    // If the singleton socket connected before this effect ran (e.g. remount
    // after hot reload), sync the state outside the effect body.
    const timer = window.setTimeout(update, 0)
    return () => {
      socket.off('connect', update)
      socket.off('disconnect', update)
      window.clearTimeout(timer)
    }
  }, [])

  const joinedRoomsRef = useRef<string[]>([])

  useEffect(() => {
    const socket = getRealtimeSocket()
    const rooms = [
      activeWorkspaceId ? `workspace:${activeWorkspaceId}` : null,
      activeProjectId ? `project:${activeProjectId}` : null,
    ].filter((room): room is string => room !== null)

    const toJoin = rooms.filter((room) => !joinedRoomsRef.current.includes(room))
    const toLeave = joinedRoomsRef.current.filter((room) => !rooms.includes(room))
    if (toJoin.length > 0) socket.emit('join', { rooms: toJoin })
    if (toLeave.length > 0) socket.emit('leave', { rooms: toLeave })
    joinedRoomsRef.current = rooms
  }, [activeWorkspaceId, activeProjectId])

  useEffect(() => {
    const socket = getRealtimeSocket()

    const onIssueSync = (event: IssueSyncEvent) => {
      void queryClient.invalidateQueries({ queryKey: ['board', event.projectId] })
      if (event.issueId) {
        void queryClient.invalidateQueries({ queryKey: ['issue', event.issueId] })
      }
      if (event.reason === 'deleted' && event.issueId === selectedIssueRef.current) {
        setSelectedIssueId(null)
        toast.info('This issue was deleted by a teammate')
      }
    }

    const onWorkspaceSync = (payload: { workspaceId: string }) => {
      void queryClient.invalidateQueries({ queryKey: ['workspace', payload.workspaceId] })
      void queryClient.invalidateQueries({ queryKey: ['workspaces'] })
    }

    socket.on('issue:sync', onIssueSync)
    socket.on('workspace:sync', onWorkspaceSync)
    return () => {
      socket.off('issue:sync', onIssueSync)
      socket.off('workspace:sync', onWorkspaceSync)
    }
  }, [queryClient])

  /* --------------------------- Derived handlers --------------------------- */

  const handleSelectWorkspace = useCallback((workspaceId: string) => {
    setRequestedWorkspaceId(workspaceId)
    setRequestedProjectId(null)
    setSelectedIssueId(null)
    setSettingsOpen(false)
    setMobileNavOpen(false)
  }, [])

  const handleSelectProject = useCallback((projectId: string | null) => {
    setRequestedProjectId(projectId)
    setSelectedIssueId(null)
    setSettingsOpen(false)
    setMobileNavOpen(false)
  }, [])

  const handleOpenSettings = useCallback(() => {
    setSettingsOpen(true)
    setMobileNavOpen(false)
  }, [])

  const handleWorkspaceDeleted = useCallback(() => {
    setSettingsOpen(false)
    setRequestedWorkspaceId(null)
    setRequestedProjectId(null)
    setSelectedIssueId(null)
    if (activeWorkspaceId) {
      queryClient.removeQueries({ queryKey: ['workspace', activeWorkspaceId] })
    }
    void queryClient.invalidateQueries({ queryKey: ['workspaces'] })
  }, [queryClient, activeWorkspaceId])

  const handleOpenIssue = useCallback((issueId: string) => {
    setSelectedIssueId(issueId)
  }, [])

  const handleCreateIssue = useCallback((status: IssueStatus) => {
    setCreateIssueStatus(status)
    setCreateIssueOpen(true)
  }, [])

  const sidebarProps = {
    sessionUser,
    workspaces: workspacesQuery.data ?? [],
    workspacesLoading: workspacesQuery.isPending,
    workspaceDetail: detail,
    activeWorkspaceId,
    activeProjectId,
    settingsOpen,
    realtimeConnected,
    onSelectWorkspace: handleSelectWorkspace,
    onSelectProject: handleSelectProject,
    onOpenSettings: handleOpenSettings,
  }

  const activeProjectName =
    projects?.find((p) => p.id === activeProjectId)?.name ?? null

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="hidden w-64 shrink-0 border-r md:block">
        <SidebarContent {...sidebarProps} />
      </aside>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-72 border-r p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">
            Workspaces, projects and members
          </SheetDescription>
          <SidebarContent {...sidebarProps} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="flex h-12 shrink-0 items-center gap-1.5 border-b bg-background px-3 md:hidden">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            aria-label="Open navigation"
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu className="h-4 w-4" aria-hidden />
          </Button>
          <span className="min-w-0 truncate text-sm font-medium">
            {detail?.workspace.name ?? 'Mini-Linear'}
          </span>
          {activeProjectName && !settingsOpen ? (
            <>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 truncate text-sm text-muted-foreground">{activeProjectName}</span>
            </>
          ) : null}
          {settingsOpen ? (
            <>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 truncate text-sm text-muted-foreground">Settings</span>
            </>
          ) : null}
          <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground" title={realtimeConnected ? 'Realtime connected' : 'Realtime offline'}>
            {realtimeConnected ? (
              <Wifi className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
            ) : (
              <WifiOff className="h-3.5 w-3.5" aria-hidden />
            )}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-8 shrink-0 gap-1.5 px-2"
            disabled={!activeWorkspaceId}
            onClick={() => setCopilotOpen(true)}
          >
            <Bot className="h-4 w-4 text-violet-500" aria-hidden />
            <span className="hidden sm:inline">Ask Copilot</span>
          </Button>
        </header>

        {/* Desktop top bar */}
        <header className="hidden h-12 shrink-0 items-center gap-2 border-b bg-background px-4 md:flex">
          <span className="truncate text-sm font-medium">{detail?.workspace.name ?? 'Mini-Linear'}</span>
          {activeProjectName && !settingsOpen ? (
            <>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate text-sm text-muted-foreground">{activeProjectName}</span>
            </>
          ) : null}
          {settingsOpen ? (
            <>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate text-sm text-muted-foreground">Settings</span>
            </>
          ) : null}
          <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground" title={realtimeConnected ? 'Realtime connected' : 'Realtime offline'}>
            {realtimeConnected ? (
              <Wifi className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
            ) : (
              <WifiOff className="h-3.5 w-3.5" aria-hidden />
            )}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-8 shrink-0 gap-1.5"
            disabled={!activeWorkspaceId}
            onClick={() => setCopilotOpen(true)}
          >
            <Bot className="h-4 w-4 text-violet-500" aria-hidden />
            Ask Copilot
          </Button>
        </header>

        <main className="min-h-0 flex-1 overflow-hidden bg-muted/20">
          {workspacesQuery.isPending ? (
            <div className="p-6">
              <div className="h-full w-full animate-pulse rounded-xl bg-muted" />
            </div>
          ) : (workspacesQuery.data ?? []).length === 0 ? (
            <NoWorkspaceState />
          ) : !activeWorkspaceId ? null : settingsOpen && detail ? (
            <div className="h-full overflow-y-auto">
              <WorkspaceSettingsView
                detail={detail}
                sessionUser={sessionUser}
                onBack={() => setSettingsOpen(false)}
                onWorkspaceDeleted={handleWorkspaceDeleted}
              />
            </div>
          ) : boardQuery.isPending && activeProjectId ? (
            <BoardSkeleton />
          ) : boardQuery.isError && activeProjectId ? (
            <QueryErrorState
              message="This project may have been deleted, or the connection failed."
              onRetry={() => void boardQuery.refetch()}
            />
          ) : boardQuery.data && activeProjectId ? (
            <Board
              board={boardQuery.data}
              onOpenIssue={handleOpenIssue}
              onCreateIssue={handleCreateIssue}
            />
          ) : workspaceDetailQuery.isPending ? (
            <div className="p-6">
              <div className="h-full w-full animate-pulse rounded-xl bg-muted" />
            </div>
          ) : workspaceDetailQuery.isError ? (
            <QueryErrorState
              message="Could not load this workspace."
              onRetry={() => void workspaceDetailQuery.refetch()}
            />
          ) : detail ? (
            <div className="h-full overflow-y-auto">
              <WorkspaceOverview detail={detail} onSelectProject={handleSelectProject} />
            </div>
          ) : null}
        </main>
      </div>

      {/* Copilot drawer */}
      {activeWorkspaceId ? (
        <CopilotDrawer
          open={copilotOpen}
          onOpenChange={setCopilotOpen}
          workspaceId={activeWorkspaceId}
          workspaceName={detail?.workspace.name ?? null}
        />
      ) : null}

      {/* Dialogs */}
      {activeProjectId ? (
        <CreateIssueDialog
          open={createIssueOpen}
          onOpenChange={setCreateIssueOpen}
          projectId={activeProjectId}
          members={detail?.members ?? []}
          defaultStatus={createIssueStatus}
        />
      ) : null}

      {selectedIssueId ? (
        <IssueDialog
          issueId={selectedIssueId}
          members={detail?.members ?? []}
          onClose={() => setSelectedIssueId(null)}
        />
      ) : null}
    </div>
  )
}

/* ----------------------------- Empty / error ------------------------------ */

function NoWorkspaceState() {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [pending, setPending] = useState(false)

  async function handleCreate() {
    if (name.trim().length < 2 || pending) return
    setPending(true)
    try {
      const result = await createWorkspaceAction({ name: name.trim() })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success('Workspace created')
      await queryClient.invalidateQueries({ queryKey: ['workspaces'] })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <KanbanSquare className="h-6 w-6" aria-hidden />
          </div>
          <div>
            <h2 className="text-lg font-semibold">You&apos;re not in a workspace yet</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              You are signed in, but this account isn&apos;t a member of any workspace yet.
              Create one below, or sign out and pick a demo account (e.g. Ada Lin) to
              explore the seeded Acme Product workspace.
            </p>
          </div>
          <div className="flex w-full max-w-xs gap-2">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Workspace name"
              maxLength={60}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleCreate()
              }}
            />
            <Button onClick={() => void handleCreate()} disabled={name.trim().length < 2 || pending}>
              <Plus className="h-4 w-4" aria-hidden />
              Create
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function QueryErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex h-full items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-muted-foreground">{message}</p>
          <Button variant="outline" onClick={onRetry}>
            <RefreshCcw className="h-4 w-4" aria-hidden />
            Try again
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
