/**
 * Idempotent demo seed for Mini-Linear.
 * Re-running replaces the demo workspace with fresh deterministic data.
 *
 * Run: bun prisma/seed.ts
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const DEMO_WORKSPACE_NAME = 'Acme Product'

const USERS = [
  { email: 'ada@acme.dev', name: 'Ada Lin' },
  { email: 'marcus@acme.dev', name: 'Marcus Chen' },
  { email: 'priya@acme.dev', name: 'Priya Nair' },
  { email: 'sam@acme.dev', name: 'Sam Okafor' },
  // The preview owner's real email. Signing in with it must land inside the
  // seeded workspace in any new tab, never on the empty "create workspace"
  // screen (that looked like a broken login button).
  { email: 'gojems321@gmail.com', name: 'Gojems' },
] as const

async function main() {
  const users = new Map<string, { id: string; name: string }>()
  for (const u of USERS) {
    const user = await db.user.upsert({
      where: { email: u.email },
      update: { name: u.name },
      create: { email: u.email, name: u.name },
    })
    users.set(u.email, { id: user.id, name: user.name })
  }

  const ada = users.get('ada@acme.dev')!
  const marcus = users.get('marcus@acme.dev')!
  const priya = users.get('priya@acme.dev')!
  const sam = users.get('sam@acme.dev')!
  const gojems = users.get('gojems321@gmail.com')!

  // Wipe ALL previous demo data (workspaces cascade to members, projects,
  // issues, comments, activities) and any users left over from testing, so
  // the seed is fully deterministic.
  await db.workspace.deleteMany({})
  const demoEmails = USERS.map((u) => u.email)
  await db.user.deleteMany({ where: { email: { notIn: demoEmails } } })

  const workspace = await db.workspace.create({
    data: { name: DEMO_WORKSPACE_NAME, ownerId: ada.id },
  })

  await db.workspaceMember.createMany({
    data: [
      { workspaceId: workspace.id, userId: ada.id, role: 'OWNER' },
      { workspaceId: workspace.id, userId: marcus.id, role: 'ADMIN' },
      { workspaceId: workspace.id, userId: priya.id, role: 'MEMBER' },
      { workspaceId: workspace.id, userId: sam.id, role: 'MEMBER' },
      { workspaceId: workspace.id, userId: gojems.id, role: 'OWNER' },
    ],
  })

  const webPlatform = await db.project.create({
    data: {
      name: 'Web Platform',
      description: 'Customer-facing dashboard and marketing site rebuild.',
      workspaceId: workspace.id,
      createdById: ada.id,
    },
  })

  const mobileApp = await db.project.create({
    data: {
      name: 'Mobile App',
      description: 'iOS and Android companion app for field teams.',
      workspaceId: workspace.id,
      createdById: marcus.id,
    },
  })

  type SeedIssue = {
    title: string
    description: string
    status: 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'DONE'
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
    assigneeId: string | null
    comments?: { authorId: string; body: string }[]
    transitions?: { actorId: string; from: string; to: string }[]
  }

  const STATUS_LABEL: Record<SeedIssue['status'], string> = {
    BACKLOG: 'Backlog',
    TODO: 'To Do',
    IN_PROGRESS: 'In Progress',
    DONE: 'Done',
  }

  const webIssues: SeedIssue[] = [
    {
      title: 'Redesign settings page with tabbed sections',
      description:
        'Split account, notifications and billing into tabs. Keep the URL hash in sync so deep links still work after the refactor.',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      assigneeId: priya.id,
      comments: [
        { authorId: ada.id, body: 'Billing tab should hide the plan selector for enterprise accounts.' },
        { authorId: priya.id, body: 'Noted — I will gate it behind the entitlements flag.' },
      ],
      transitions: [{ actorId: priya.id, from: 'TODO', to: 'IN_PROGRESS' }],
    },
    {
      title: 'Fix session refresh racing on multi-tab logout',
      description:
        'Logging out in one tab leaves stale tokens in other tabs. Broadcast a logout event and clear in-memory caches everywhere.',
      status: 'IN_PROGRESS',
      priority: 'URGENT',
      assigneeId: marcus.id,
      comments: [{ authorId: marcus.id, body: 'Reproduced with two tabs and a slow network. Root cause: refresh timer not cancelled.' }],
      transitions: [{ actorId: marcus.id, from: 'BACKLOG', to: 'IN_PROGRESS' }],
    },
    {
      title: 'Add keyboard shortcuts for issue navigation',
      description: 'j/k to move selection, enter to open, esc to close. Follow the same pattern as the command palette.',
      status: 'TODO',
      priority: 'MEDIUM',
      assigneeId: sam.id,
    },
    {
      title: 'Migrate avatar storage to CDN with signed URLs',
      description: 'Uploads currently hit the app server. Move to CDN origin with short-lived signed GETs.',
      status: 'TODO',
      priority: 'LOW',
      assigneeId: null,
    },
    {
      title: 'Empty states for filtered board columns',
      description: 'When a filter matches nothing, show an illustration plus a one-click "clear filter" action.',
      status: 'BACKLOG',
      priority: 'LOW',
      assigneeId: null,
    },
    {
      title: 'Audit log export as CSV for admins',
      description: 'Admins need 90 days of activity exportable per project. Stream the CSV to avoid loading everything in memory.',
      status: 'BACKLOG',
      priority: 'MEDIUM',
      assigneeId: marcus.id,
    },
    {
      title: 'Ship dark mode for marketing site',
      description: 'Hero, pricing and footer need dark variants. Reuse the app theme tokens.',
      status: 'DONE',
      priority: 'MEDIUM',
      assigneeId: priya.id,
      transitions: [{ actorId: priya.id, from: 'IN_PROGRESS', to: 'DONE' }],
    },
    {
      title: 'Rate limit public form submissions',
      description: 'Per-IP token bucket in front of the public intake form. Alert at 80% bucket usage.',
      status: 'DONE',
      priority: 'HIGH',
      assigneeId: ada.id,
      comments: [{ authorId: ada.id, body: 'Shipped with a 20 req/min bucket and a monitoring alarm.' }],
      transitions: [{ actorId: ada.id, from: 'IN_PROGRESS', to: 'DONE' }],
    },
  ]

  const mobileIssues: SeedIssue[] = [
    {
      title: 'Offline queue for inspection photos',
      description: 'Queue uploads in IndexedDB and retry with exponential backoff when connectivity returns.',
      status: 'TODO',
      priority: 'HIGH',
      assigneeId: sam.id,
    },
    {
      title: 'Crash on Android 14 when opening camera',
      description: 'Only reproduces on Pixel 8. Stack trace points to a missing foreground service declaration.',
      status: 'IN_PROGRESS',
      priority: 'URGENT',
      assigneeId: marcus.id,
    },
    {
      title: 'Deep links from email digests',
      description: 'Route notification emails to the exact issue screen on both platforms.',
      status: 'BACKLOG',
      priority: 'MEDIUM',
      assigneeId: null,
    },
  ]

  const POSITION_STEP = 1024

  async function seedProject(projectId: string, definition: SeedIssue[]) {
    const counters = new Map<string, number>()
    for (const def of definition) {
      const index = counters.get(def.status) ?? 0
      counters.set(def.status, index + 1)

      const issue = await db.issue.create({
        data: {
          title: def.title,
          description: def.description,
          status: def.status,
          priority: def.priority,
          position: (index + 1) * POSITION_STEP,
          projectId,
          assigneeId: def.assigneeId,
          createdById: ada.id,
        },
      })

      const activities: { type: string; message: string; issueId: string; projectId: string; actorId: string }[] = [
        {
          type: 'ISSUE_CREATED',
          message: `${ada.name} created this issue in ${STATUS_LABEL[def.status]}`,
          issueId: issue.id,
          projectId,
          actorId: ada.id,
        },
      ]
      for (const t of def.transitions ?? []) {
        const actorName =
          t.actorId === ada.id ? ada.name : t.actorId === marcus.id ? marcus.name : t.actorId === priya.id ? priya.name : sam.name
        activities.push({
          type: 'STATUS_CHANGED',
          message: `${actorName} moved this issue from ${STATUS_LABEL[t.from as SeedIssue['status']]} to ${STATUS_LABEL[t.to as SeedIssue['status']]}`,
          issueId: issue.id,
          projectId,
          actorId: t.actorId,
        })
      }
      await db.activity.createMany({ data: activities })

      for (const c of def.comments ?? []) {
        await db.comment.create({
          data: { body: c.body, issueId: issue.id, authorId: c.authorId },
        })
      }
    }
  }

  await seedProject(webPlatform.id, webIssues)
  await seedProject(mobileApp.id, mobileIssues)

  const counts = {
    users: await db.user.count(),
    members: await db.workspaceMember.count(),
    projects: await db.project.count(),
    issues: await db.issue.count(),
    comments: await db.comment.count(),
    activities: await db.activity.count(),
  }
  console.log('Seed complete:', counts)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
