import { Providers } from '@/components/app/providers'
import { AppShell } from '@/components/app/app-shell'
import { SignInView } from '@/components/app/sign-in-view'
import { getSessionUser, listWorkspaces } from '@/server/queries'

/**
 * The only user-visible route. Everything else is client-side view state
 * inside AppShell (the sandbox exposes a single route through the gateway).
 */
export default async function Home() {
  const sessionUser = await getSessionUser()

  if (!sessionUser) {
    return (
      <Providers>
        <SignInView />
      </Providers>
    )
  }

  const initialWorkspaces = await listWorkspaces()

  return (
    <Providers>
      <AppShell sessionUser={sessionUser} initialWorkspaces={initialWorkspaces} />
    </Providers>
  )
}
