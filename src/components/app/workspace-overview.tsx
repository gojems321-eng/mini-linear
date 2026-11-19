'use client'

import { useState } from 'react'
import { FolderKanban, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { CreateProjectDialog } from '@/components/app/create-project-dialog'
import type { WorkspaceDetail } from '@/lib/types'

interface WorkspaceOverviewProps {
  detail: WorkspaceDetail
  onSelectProject: (projectId: string) => void
}

export function WorkspaceOverview({ detail, onSelectProject }: WorkspaceOverviewProps) {
  const [createOpen, setCreateOpen] = useState(false)

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3 pb-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{detail.workspace.name}</h1>
          <p className="text-sm text-muted-foreground">
            {detail.projects.length} {detail.projects.length === 1 ? 'project' : 'projects'} ·{' '}
            {detail.members.length} {detail.members.length === 1 ? 'member' : 'members'}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden />
          New project
        </Button>
      </div>

      {detail.projects.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <FolderKanban className="h-10 w-10 text-muted-foreground" aria-hidden />
            <div>
              <p className="font-medium">No projects yet</p>
              <p className="text-sm text-muted-foreground">
                Create your first project to get a Kanban board with Backlog, To Do, In Progress and Done.
              </p>
            </div>
            <Button variant="outline" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              Create project
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {detail.projects.map((project) => (
            <li key={project.id}>
              <Card className="h-full transition-colors hover:border-foreground/30">
                <CardContent className="flex h-full flex-col gap-2 p-4">
                  <div className="flex items-center gap-2">
                    <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <h2 className="truncate font-medium">{project.name}</h2>
                    <span className="ml-auto text-xs text-muted-foreground">{project.issueCount} issues</span>
                  </div>
                  <p className="line-clamp-2 min-h-[2.5rem] text-sm text-muted-foreground">
                    {project.description ?? 'No description'}
                  </p>
                  <div className="mt-auto pt-2">
                    <Button variant="secondary" size="sm" className="w-full" onClick={() => onSelectProject(project.id)}>
                      Open board
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <CreateProjectDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        workspaceId={detail.workspace.id}
        onCreated={(projectId) => onSelectProject(projectId)}
      />
    </div>
  )
}
