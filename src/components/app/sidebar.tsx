'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  ChevronDown,
  FolderKanban,
  LogOut,
  Plus,
  Settings,
  Trash2,
  MoreHorizontal,
  LayoutGrid,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import {
  avatarColorFor,
  initialsFor,
  ROLE_BADGE_CLASSES,
} from '@/lib/types'
import type {
  SessionUser,
  WorkspaceDetail,
  WorkspaceSummary,
} from '@/lib/types'
import { createWorkspaceAction, signOutAction } from '@/server/actions/workspace'
import { deleteProjectAction } from '@/server/actions/project'
import { useAction } from '@/components/app/use-action'
import { CreateProjectDialog } from '@/components/app/create-project-dialog'

export interface SidebarContentProps {
  sessionUser: SessionUser
  workspaces: WorkspaceSummary[]
  workspacesLoading: boolean
  workspaceDetail: WorkspaceDetail | undefined
  activeWorkspaceId: string | null
  activeProjectId: string | null
  settingsOpen: boolean
  realtimeConnected: boolean
  onSelectWorkspace: (id: string) => void
  onSelectProject: (id: string | null) => void
  onOpenSettings: () => void
}

/**
 * Primary navigation. Member and workspace management live in the Settings
 * view (src/components/app/workspace-settings-view.tsx); the sidebar keeps a
 * read-only member roster with role badges and the entry point to settings.
 */
export function SidebarContent({
  sessionUser,
  workspaces,
  workspacesLoading,
  workspaceDetail,
  activeWorkspaceId,
  activeProjectId,
  settingsOpen,
  realtimeConnected,
  onSelectWorkspace,
  onSelectProject,
  onOpenSettings,
}: SidebarContentProps) {
  const queryClient = useQueryClient()
  const { run, isPending } = useAction()

  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false)
  const [newWorkspaceName, setNewWorkspaceName] = useState('')
  const [newProjectOpen, setNewProjectOpen] = useState(false)

  const detail = workspaceDetail
  const myRole = detail?.role ?? 'MEMBER'
  const canManage = myRole === 'OWNER' || myRole === 'ADMIN'
  const projects = detail?.projects ?? []
  const members = detail?.members ?? []

  function invalidateWorkspace() {
    if (activeWorkspaceId) {
      void queryClient.invalidateQueries({ queryKey: ['workspace', activeWorkspaceId] })
    }
    void queryClient.invalidateQueries({ queryKey: ['workspaces'] })
  }

  async function handleCreateWorkspace() {
    const data = await run(
      'create-workspace',
      () => createWorkspaceAction({ name: newWorkspaceName.trim() }),
      { successMessage: 'Workspace created' },
    )
    if (data) {
      setNewWorkspaceOpen(false)
      setNewWorkspaceName('')
      invalidateWorkspace()
      onSelectWorkspace(data.workspaceId)
    }
  }

  async function handleDeleteProject(projectId: string, projectName: string) {
    if (!activeWorkspaceId) return
    const data = await run(
      'delete-project',
      () => deleteProjectAction({ workspaceId: activeWorkspaceId, projectId }),
      { successMessage: `Deleted "${projectName}"` },
    )
    if (data !== null) {
      invalidateWorkspace()
      if (activeProjectId === projectId) {
        onSelectProject(null)
      }
    }
  }

  async function handleSignOut() {
    await signOutAction()
    toast.success('Signed out')
  }

  const activeWorkspaceName =
    workspaces.find((w) => w.id === activeWorkspaceId)?.name ?? detail?.workspace.name ?? 'No workspace'

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Brand + workspace switcher */}
      <div className="p-3">
        <div className="flex items-center gap-2 px-1 pb-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <LayoutGrid className="h-4 w-4" aria-hidden />
          </div>
          <span className="text-sm font-semibold tracking-tight">Mini-Linear</span>
          <span
            className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground"
            title={realtimeConnected ? 'Realtime connected' : 'Realtime offline'}
          >
            {realtimeConnected ? (
              <Wifi className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
            ) : (
              <WifiOff className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            )}
          </span>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="w-full justify-between font-normal"
              aria-label="Switch workspace"
            >
              <span className="truncate">{activeWorkspaceName}</span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
            {workspacesLoading ? (
              <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
            ) : workspaces.length === 0 ? (
              <DropdownMenuItem disabled>No workspaces yet</DropdownMenuItem>
            ) : (
              workspaces.map((workspace) => (
                <DropdownMenuItem
                  key={workspace.id}
                  onClick={() => onSelectWorkspace(workspace.id)}
                  className="justify-between"
                >
                  <span className="truncate">{workspace.name}</span>
                  <Badge variant="outline" className={cn('text-[10px] px-1.5', ROLE_BADGE_CLASSES[workspace.role])}>
                    {workspace.role}
                  </Badge>
                </DropdownMenuItem>
              ))
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setNewWorkspaceOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              New workspace
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Separator />

      {/* Projects + settings entry */}
      <div className="flex-1 min-h-0">
        <ScrollArea className="h-full">
          <div className="p-3 space-y-4">
            <section aria-label="Projects">
              <div className="flex items-center justify-between px-1 pb-1.5">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Projects
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  aria-label="New project"
                  onClick={() => setNewProjectOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </div>
              {!activeWorkspaceId ? (
                <p className="px-1 text-xs text-muted-foreground">Create a workspace first.</p>
              ) : projects.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">No projects yet.</p>
              ) : (
                <ul className="space-y-0.5">
                  {projects.map((project) => {
                    const active = project.id === activeProjectId
                    return (
                      <li key={project.id} className="group flex items-center">
                        <button
                          type="button"
                          onClick={() => onSelectProject(project.id)}
                          className={cn(
                            'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent',
                            active && 'bg-accent font-medium',
                          )}
                        >
                          <FolderKanban
                            className={cn('h-4 w-4 shrink-0', active ? 'text-foreground' : 'text-muted-foreground')}
                            aria-hidden
                          />
                          <span className="truncate">{project.name}</span>
                          <span className="ml-auto text-xs text-muted-foreground">{project.issueCount}</span>
                        </button>
                        {canManage ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 shrink-0 p-0 opacity-0 group-hover:opacity-100 focus:opacity-100"
                                aria-label={`Manage ${project.name}`}
                              >
                                <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => void handleDeleteProject(project.id, project.name)}
                              >
                                <Trash2 className="h-4 w-4" aria-hidden />
                                Delete project
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            <Separator />

            {/* Workspace settings entry */}
            {activeWorkspaceId ? (
              <section aria-label="Workspace settings">
                <button
                  type="button"
                  onClick={onOpenSettings}
                  aria-current={settingsOpen ? 'page' : undefined}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent',
                    settingsOpen && 'bg-accent font-medium',
                  )}
                >
                  <Settings
                    className={cn(
                      'h-4 w-4 shrink-0',
                      settingsOpen ? 'text-foreground' : 'text-muted-foreground',
                    )}
                    aria-hidden
                  />
                  Workspace settings
                </button>
              </section>
            ) : null}

            <Separator />

            {/* Members roster (read-only; management happens in Settings) */}
            <section aria-label="Members">
              <div className="px-1 pb-1.5">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Members
                </span>
              </div>
              {members.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">
                  {activeWorkspaceId ? 'No members yet.' : 'Select a workspace to see members.'}
                </p>
              ) : (
                <ul className="space-y-1">
                  {members.map((member) => {
                    const isSelf = member.userId === sessionUser.id
                    return (
                      <li key={member.membershipId} className="flex items-center gap-2 rounded-md px-1 py-1">
                        <Avatar className="h-6 w-6">
                          <AvatarFallback className={cn('text-[10px] text-white', avatarColorFor(member.userId))}>
                            {initialsFor(member.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium leading-tight">
                            {member.name}
                            {isSelf ? ' (you)' : ''}
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground leading-tight">{member.email}</p>
                        </div>
                        <Badge variant="outline" className={cn('text-[10px] px-1.5', ROLE_BADGE_CLASSES[member.role])}>
                          {member.role}
                        </Badge>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          </div>
        </ScrollArea>
      </div>

      <Separator />

      {/* Session user footer */}
      <div className="flex items-center gap-2 p-3">
        <Avatar className="h-8 w-8">
          <AvatarFallback className={cn('text-xs text-white', avatarColorFor(sessionUser.id))}>
            {initialsFor(sessionUser.name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium leading-tight">{sessionUser.name}</p>
          <p className="truncate text-xs text-muted-foreground leading-tight">{sessionUser.email}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          aria-label="Sign out"
          onClick={() => void handleSignOut()}
        >
          <LogOut className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      {/* New workspace dialog */}
      <Dialog open={newWorkspaceOpen} onOpenChange={setNewWorkspaceOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create workspace</DialogTitle>
            <DialogDescription>You will be the owner of this workspace.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="workspace-name">Workspace name</Label>
            <Input
              id="workspace-name"
              value={newWorkspaceName}
              onChange={(event) => setNewWorkspaceName(event.target.value)}
              placeholder="Acme Product"
              maxLength={60}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && newWorkspaceName.trim().length >= 2) {
                  void handleCreateWorkspace()
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewWorkspaceOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={newWorkspaceName.trim().length < 2 || isPending('create-workspace')}
              onClick={() => void handleCreateWorkspace()}
            >
              Create workspace
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New project dialog */}
      {activeWorkspaceId ? (
        <CreateProjectDialog
          open={newProjectOpen}
          onOpenChange={setNewProjectOpen}
          workspaceId={activeWorkspaceId}
          onCreated={(projectId) => onSelectProject(projectId)}
        />
      ) : null}
    </div>
  )
}
