'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
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
import { createProjectAction } from '@/server/actions/project'
import { useAction } from '@/components/app/use-action'

interface CreateProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  onCreated: (projectId: string) => void
}

export function CreateProjectDialog({ open, onOpenChange, workspaceId, onCreated }: CreateProjectDialogProps) {
  const queryClient = useQueryClient()
  const { run, isPending } = useAction()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  async function handleCreate() {
    const data = await run(
      'create-project',
      () =>
        createProjectAction({
          workspaceId,
          name: name.trim(),
          description: description.trim() || undefined,
        }),
      { successMessage: 'Project created' },
    )
    if (data) {
      onOpenChange(false)
      setName('')
      setDescription('')
      void queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId] })
      void queryClient.invalidateQueries({ queryKey: ['workspaces'] })
      onCreated(data.projectId)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>Projects get a Kanban board with four columns.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="overview-project-name">Project name</Label>
            <Input
              id="overview-project-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Web Platform"
              maxLength={60}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && name.trim().length >= 2) {
                  void handleCreate()
                }
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="overview-project-description">Description (optional)</Label>
            <Input
              id="overview-project-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What is this project about?"
              maxLength={280}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={name.trim().length < 2 || isPending('create-project')} onClick={() => void handleCreate()}>
            Create project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
