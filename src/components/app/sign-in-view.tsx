'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { KanbanSquare, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { signInAction } from '@/server/actions/workspace'

const DEMO_ACCOUNTS = [
  { email: 'ada@acme.dev', name: 'Ada Lin', role: 'Owner' },
  { email: 'marcus@acme.dev', name: 'Marcus Chen', role: 'Admin' },
  { email: 'priya@acme.dev', name: 'Priya Nair', role: 'Member' },
] as const

export function SignInView() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function signIn(targetEmail: string, targetName?: string) {
    setSubmitting(true)
    try {
      const result = await signInAction({ email: targetEmail, name: targetName })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(`Signed in as ${result.data.name}`)
      router.refresh()
    } catch {
      // A rejected action call (network drop, gateway hiccup, hard 500) must
      // never fail silently — the button would just stop spinning with no
      // feedback. Surface it like any other sign-in failure.
      toast.error('Could not reach the server. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-md space-y-4">
        <div className="flex flex-col items-center gap-2 py-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <KanbanSquare className="h-6 w-6" aria-hidden />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Mini-Linear</h1>
          <p className="text-sm text-muted-foreground text-center">
            Multi-tenant Kanban &amp; issue tracker for your team
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>
              Use an email to sign in. New emails get an account automatically.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                void signIn(email.trim())
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@company.dev"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">
                  Display name <span className="text-muted-foreground">(new accounts only)</span>
                </Label>
                <Input
                  id="name"
                  autoComplete="name"
                  placeholder="Ada Lin"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={submitting || email.trim().length === 0}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                Continue with email
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Demo accounts</CardTitle>
            <CardDescription className="text-xs">
              One click signs you in with that role. To watch realtime updates from a
              second account, open a private/incognito window and pick a different
              account there — tabs in the same browser share one session.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {DEMO_ACCOUNTS.map((account) => (
              <Button
                key={account.email}
                variant="outline"
                className="justify-between"
                disabled={submitting}
                onClick={() => void signIn(account.email, account.name)}
              >
                <span>{account.name}</span>
                <span className="text-xs text-muted-foreground">{account.role}</span>
              </Button>
            ))}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
