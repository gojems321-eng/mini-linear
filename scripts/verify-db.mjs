// Independent verification that the demo data really landed in the
// database that DATABASE_URL currently points at.
// Run: bun scripts/verify-db.mjs  (bun auto-loads .env)
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const [users, members, projects, issues, comments, activities] = await Promise.all([
  db.user.count(),
  db.workspaceMember.count(),
  db.project.count(),
  db.issue.count(),
  db.comment.count(),
  db.activity.count(),
])

const workspace = await db.workspace.findFirst({
  include: { members: { include: { user: { select: { email: true } } } }, projects: { select: { name: true } } },
})

console.log('Connected to:', process.env.DATABASE_URL?.split('@')[1]?.split('/')[0] ?? 'unknown host')
console.log('Counts:', { users, members, projects, issues, comments, activities })
console.log('Workspace:', workspace?.name)
console.log('Projects:', workspace?.projects.map((p) => p.name).join(' | '))
console.log('Members:', workspace?.members.map((m) => `${m.user.email}=${m.role}`).join(' | '))

const statusBreakdown = await db.issue.groupBy({ by: ['status'], _count: true })
console.log('Issues by status:', statusBreakdown.map((s) => `${s.status}:${s._count}`).join(' '))

await db.$disconnect()
