'use client'

import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  AlertTriangle,
  ArrowLeft,
  Loader2,
  MoreHorizontal,
  ShieldCheck,
  Trash2,
  UserPlus,
} from 'lucide-react'
import { toast } from 'sonner'
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
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import {
  avatarColorFor,
  initialsFor,
  ROLE_BADGE_CLASSES,
  WORKSPACE_ROLES,
} from '@/lib/types'
import type {
  MemberInfo,
  SessionUser,
  SettingsActionResult,
  WorkspaceDetail,
  WorkspaceRole,
} from '@/lib/types'
import {
  deleteWorkspaceAction,
  inviteMemberAction,
  removeMemberAction,
  updateMemberRoleAction,
  updateWorkspaceAction,
} from '@/actions/workspace-settings'

const ROLE_LABELS: Record<WorkspaceRole, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MEMBER: 'Member',
}

/** Role descriptions shown in the role dropdown and invite selector. */
const ROLE_HINTS: Record<WorkspaceRole, string> = {
  OWNER: 'Full control, including deleting the workspace',
  ADMIN: 'Invite members and manage projects',
  MEMBER: 'Work on issues in projects',
}

interface WorkspaceSettingsViewProps {
  detail: WorkspaceDetail
  sessionUser: SessionUser
  onBack: () => void
  onWorkspaceDeleted: () => void
}

/**
 * Workspace Settings: general info, invitations and the team directory with
 * RBAC-aware controls. The permission matrix is enforced server-side in
 * src/actions/workspace-settings.ts; this view MIRRORS it by hiding every
 * control the current viewer is not allowed to use.
 *
 *   OWNER  -> rename, delete (danger zone), invite, manage all roles
 *   ADMIN  -> invite, manage ADMIN<->MEMBER roles, remove MEMBERs
 *   MEMBER -> read-only directory
 */
export function WorkspaceSettingsView({
  detail,
  sessionUser,
  onBack,
  onWorkspaceDeleted,
}: WorkspaceSettingsViewProps) {
  const queryClient = useQueryClient()

  const [nameInput, setNameInput] = useState(detail.workspace.name)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'ADMIN' | 'MEMBER'>('MEMBER')
  const [pending, setPending] = useState<Record<string, boolean>>({})
  /** Member whose removal/leave confirmation dialog is open, if any. */
  const [removalTarget, setRemovalTarget] = useState<MemberInfo | null>(null)

  // Keep the rename input in sync when the workspace is renamed elsewhere
  // (e.g. realtime sync from a second tab of the same owner).
  useEffect(() => {
    setNameInput(detail.workspace.name)
  }, [detail.workspace.name, detail.workspace.id])

  const myRole = detail.role
  const isOwner = myRole === 'OWNER'
  const isAdminOrAbove = myRole === 'OWNER' || myRole === 'ADMIN'
  const members = detail.members
  const ownerCount = members.filter((member) => member.role === 'OWNER').length

  /* --------------------------- Mutation helper ---------------------------- */

  async function run<T>(
    key: string,
    fn: () => Promise<SettingsActionResult<T>>,
    successMessage?: string,
  ): Promise<{ ok: true; data: T } | { ok: false }> {
    setPending((prev) => ({ ...prev, [key]: true }))
    try {
      const result = await fn()
      if (!result.success) {
        toast.error(result.error)
        return { ok: false }
      }
      if (successMessage) toast.success(successMessage)
      return { ok: true, data: result.data }
    } catch {
      // The action call itself was rejected (network/gateway) — never silent.
      toast.error('Could not reach the server. Please try again.')
      return { ok: false }
    } finally {
      setPending((prev) => ({ ...prev, [key]: false }))
    }
  }

  function invalidateWorkspaceData() {
    void queryClient.invalidateQueries({ queryKey: ['workspace', detail.workspace.id] })
    void queryClient.invalidateQueries({ queryKey: ['workspaces'] })
  }

  /* ------------------------------- Handlers ------------------------------- */

  async function handleRename() {
    const trimmed = nameInput.trim()
    if (trimmed.length < 2 || trimmed === detail.workspace.name) return
    const result = await run(
      'rename',
      () => updateWorkspaceAction({ workspaceId: detail.workspace.id, name: trimmed }),
      'Workspace renamed',
    )
    if (result.ok) invalidateWorkspaceData()
  }

  async function handleInvite() {
    const result = await run(
      'invite',
      () =>
        inviteMemberAction({
          workspaceId: detail.workspace.id,
          email: inviteEmail.trim(),
          role: inviteRole,
        }),
    )
    if (result.ok) {
      toast.success(`${result.data.name} joined as ${ROLE_LABELS[result.data.role]}`)
      setInviteEmail('')
      setInviteRole('MEMBER')
      invalidateWorkspaceData()
    }
  }

  async function handleRoleChange(member: MemberInfo, role: WorkspaceRole) {
    const result = await run(
      `role-${member.membershipId}`,
      () =>
        updateMemberRoleAction({
          workspaceId: detail.workspace.id,
          membershipId: member.membershipId,
          role,
        }),
      `${member.name} is now ${ROLE_LABELS[role]}`,
    )
    if (result.ok) invalidateWorkspaceData()
  }

  async function handleRemoveMember() {
    const target = removalTarget
    if (!target) return
    const isSelf = target.userId === sessionUser.id
    const result = await run(
      `remove-${target.membershipId}`,
      () =>
        removeMemberAction({
          workspaceId: detail.workspace.id,
          membershipId: target.membershipId,
        }),
      isSelf ? `You left "${detail.workspace.name}"` : `Removed ${target.name}`,
    )
    setRemovalTarget(null)
    if (result.ok) invalidateWorkspaceData()
  }

  async function handleDeleteWorkspace() {
    const result = await run(
      'delete-workspace',
      () => deleteWorkspaceAction({ workspaceId: detail.workspace.id }),
      `"${detail.workspace.name}" was deleted`,
    )
    if (!result.ok) return
    onWorkspaceDeleted()
  }

  /* --------------------------- Row-level permissions ---------------------- */

  function canOpenRoleMenu(member: MemberInfo, isSelf: boolean): boolean {
    if (isSelf) return false
    if (myRole === 'OWNER') return true
    if (myRole === 'ADMIN') return member.role !== 'OWNER'
    return false
  }

  function canRemoveRow(member: MemberInfo, isSelf: boolean): boolean {
    if (isSelf) return false
    if (myRole === 'OWNER') return true
    if (myRole === 'ADMIN') return member.role === 'MEMBER'
    return false
  }

  function canLeaveRow(isSelf: boolean, member: MemberInfo): boolean {
    // Only an owner with a co-owner can leave from the directory; a sole
    // owner must transfer ownership first (server enforces the same rule).
    return isSelf && myRole === 'OWNER' && member.role === 'OWNER' && ownerCount > 1
  }

  const showActionsColumn = members.some((member) => {
    const isSelf = member.userId === sessionUser.id
    return canOpenRoleMenu(member, isSelf) || canRemoveRow(member, isSelf) || canLeaveRow(isSelf, member)
  })

  const removalIsSelf = removalTarget?.userId === sessionUser.id

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 pb-6">
        <Button variant="ghost" size="sm" className="h-8" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">Workspace settings</h1>
          <p className="truncate text-sm text-muted-foreground">{detail.workspace.name}</p>
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <span className="hidden sm:inline">Your role</span>
          <Badge className={cn('px-2', ROLE_BADGE_CLASSES[myRole])}>{myRole}</Badge>
        </div>
      </div>

      <div className="space-y-6">
        {/* ------------------------- General settings ------------------------ */}
        <Card>
          <CardHeader>
            <CardTitle>General</CardTitle>
            <CardDescription>Workspace identity, visible to every member.</CardDescription>
          </CardHeader>
          <CardContent>
            {isOwner ? (
              <form
                className="space-y-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  void handleRename()
                }}
              >
                <Label htmlFor="workspace-rename">Workspace name</Label>
                <div className="flex max-w-md gap-2">
                  <Input
                    id="workspace-rename"
                    value={nameInput}
                    onChange={(event) => setNameInput(event.target.value)}
                    maxLength={60}
                    aria-describedby="workspace-rename-hint"
                  />
                  <Button
                    type="submit"
                    disabled={
                      nameInput.trim().length < 2 ||
                      nameInput.trim() === detail.workspace.name ||
                      pending['rename'] === true
                    }
                  >
                    {pending['rename'] ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : null}
                    Save
                  </Button>
                </div>
                <p id="workspace-rename-hint" className="text-xs text-muted-foreground">
                  Renaming updates the name for all {members.length}{' '}
                  {members.length === 1 ? 'member' : 'members'} instantly.
                </p>
              </form>
            ) : (
              <div className="space-y-1.5">
                <Label>Workspace name</Label>
                <p className="text-sm font-medium">{detail.workspace.name}</p>
                <p className="text-xs text-muted-foreground">
                  Only the workspace owner can rename the workspace.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* --------------------------- Invite member ------------------------- */}
        {isAdminOrAbove ? (
          <Card>
            <CardHeader>
              <CardTitle>Invite member</CardTitle>
              <CardDescription>
                Unknown emails get an account automatically, so invitees can sign in right away.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="flex flex-col gap-3 sm:flex-row sm:items-end"
                onSubmit={(event) => {
                  event.preventDefault()
                  void handleInvite()
                }}
              >
                <div className="flex-1 space-y-2">
                  <Label htmlFor="invite-email">Email</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    placeholder="teammate@company.dev"
                    autoComplete="off"
                  />
                </div>
                <div className="flex-1 space-y-2">
                  <Label htmlFor="invite-role">Role</Label>
                  <Select
                    value={inviteRole}
                    onValueChange={(value) => setInviteRole(value as 'ADMIN' | 'MEMBER')}
                  >
                    <SelectTrigger id="invite-role" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MEMBER">
                        <span className="font-medium">Member</span>
                        <span className="block text-xs text-muted-foreground">{ROLE_HINTS.MEMBER}</span>
                      </SelectItem>
                      <SelectItem value="ADMIN">
                        <span className="font-medium">Admin</span>
                        <span className="block text-xs text-muted-foreground">{ROLE_HINTS.ADMIN}</span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="submit"
                  className="w-full sm:w-auto"
                  disabled={inviteEmail.trim().length === 0 || pending['invite'] === true}
                >
                  {pending['invite'] ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <UserPlus className="h-4 w-4" aria-hidden />
                  )}
                  Add member
                </Button>
              </form>
              <p className="mt-3 text-xs text-muted-foreground">
                Inviting an existing member&apos;s email is rejected — every user joins a workspace
                once.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-dashed">
            <CardContent className="flex items-start gap-3 py-4">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <div>
                <p className="text-sm font-medium">Read-only member view</p>
                <p className="text-sm text-muted-foreground">
                  Only owners and admins can invite members or change roles. Ask your workspace
                  owner if you need access.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        <Separator />

        {/* -------------------------- Team directory ------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle>Team directory</CardTitle>
            <CardDescription>
              {members.length} {members.length === 1 ? 'member' : 'members'} ·{' '}
              {ownerCount} {ownerCount === 1 ? 'owner' : 'owners'} · every mutation is re-checked
              against your role on the server.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Member</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="hidden sm:table-cell">Joined</TableHead>
                    {showActionsColumn ? (
                      <TableHead className="text-right">Actions</TableHead>
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((member) => {
                    const isSelf = member.userId === sessionUser.id
                    const roleMenu = canOpenRoleMenu(member, isSelf)
                    const removable = canRemoveRow(member, isSelf)
                    const leavable = canLeaveRow(isSelf, member)

                    return (
                      <TableRow key={member.membershipId}>
                        <TableCell className="max-w-[16rem]">
                          <div className="flex items-center gap-3">
                            <Avatar className="h-8 w-8">
                              <AvatarFallback
                                className={cn('text-xs text-white', avatarColorFor(member.userId))}
                              >
                                {initialsFor(member.name)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium leading-tight">
                                {member.name}
                                {isSelf ? (
                                  <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>
                                ) : null}
                              </p>
                              <p className="truncate text-xs text-muted-foreground leading-tight">
                                {member.email}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <Badge className={cn('px-2', ROLE_BADGE_CLASSES[member.role])}>
                              {member.role}
                            </Badge>
                            {roleMenu ? (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 w-7 p-0"
                                    aria-label={`Change role for ${member.name}`}
                                    disabled={pending[`role-${member.membershipId}`] === true}
                                  >
                                    {pending[`role-${member.membershipId}`] ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                                    ) : (
                                      <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
                                    )}
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start" className="w-56">
                                  <DropdownMenuLabel className="text-xs">
                                    Change role
                                  </DropdownMenuLabel>
                                  {WORKSPACE_ROLES.filter((role) => role !== member.role).map(
                                    (role) => (
                                      <DropdownMenuItem
                                        key={role}
                                        disabled={
                                          myRole !== 'OWNER' && role === 'OWNER'
                                        }
                                        onClick={() => void handleRoleChange(member, role)}
                                      >
                                        <span className="font-medium">{ROLE_LABELS[role]}</span>
                                        <span className="block text-xs text-muted-foreground">
                                          {ROLE_HINTS[role]}
                                        </span>
                                      </DropdownMenuItem>
                                    ),
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="hidden whitespace-nowrap text-muted-foreground sm:table-cell">
                          {format(new Date(member.joinedAt), 'MMM d, yyyy')}
                        </TableCell>
                        {showActionsColumn ? (
                          <TableCell className="text-right">
                            {removable ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                disabled={pending[`remove-${member.membershipId}`] === true}
                                onClick={() => setRemovalTarget(member)}
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                                Remove
                              </Button>
                            ) : leavable ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8"
                                disabled={pending[`remove-${member.membershipId}`] === true}
                                onClick={() => setRemovalTarget(member)}
                              >
                                Leave
                              </Button>
                            ) : null}
                          </TableCell>
                        ) : null}
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* ---------------------------- Danger zone -------------------------- */}
        {isOwner ? (
          <Card className="border-destructive/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-4 w-4" aria-hidden />
                Danger zone
              </CardTitle>
              <CardDescription>
                Deleting the workspace permanently removes its projects, boards, issues, comments
                and activity for everyone. Member accounts are kept.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive">
                    <Trash2 className="h-4 w-4" aria-hidden />
                    Delete workspace
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete “{detail.workspace.name}”?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This permanently deletes the workspace, its {detail.projects.length}{' '}
                      {detail.projects.length === 1 ? 'project' : 'projects'} and every issue,
                      comment and activity inside it. This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => void handleDeleteWorkspace()}
                    >
                      {pending['delete-workspace'] ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      ) : null}
                      Delete workspace
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {/* Remove / leave confirmation */}
      <AlertDialog
        open={removalTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemovalTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {removalIsSelf ? 'Leave this workspace?' : `Remove ${removalTarget?.name}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {removalIsSelf
                ? 'You will immediately lose access to this workspace. You can only rejoin if someone invites you again.'
                : `${removalTarget?.name} will immediately lose access to this workspace. Their past comments and activity stay intact.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void handleRemoveMember()}
            >
              {removalTarget && pending[`remove-${removalTarget.membershipId}`] ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              {removalIsSelf ? 'Leave workspace' : 'Remove member'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
