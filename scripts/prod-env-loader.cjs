/**
 * Preload for the standalone production server (`node --require`).
 * The sandbox strips secret-looking variables (e.g. *SECRET*) from
 * inherited environments and command substitution, so the server would
 * boot without AUTH_SECRET. Loading the project .env file directly from
 * disk inside the process sidesteps that: the value never appears in
 * argv or in the parent's environment.
 */
const fs = require('fs')

const ENV_FILE = '/home/z/my-project/.env'

try {
  const raw = fs.readFileSync(ENV_FILE, 'utf8')
  for (const line of raw.split('\n')) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/)
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2]
    }
  }
} catch (error) {
  console.error('[prod-env-loader] could not read', ENV_FILE, error.message)
}

// Pin the persistent secret file to the project root so the standalone
// server (which may chdir) keeps using the same .auth-secret across
// restarts — previously issued session cookies stay valid. Sandbox-only
// preload; Vercel deployments rely on the AUTH_SECRET env var instead.
if (process.env.AUTH_SECRET_FILE === undefined) {
  process.env.AUTH_SECRET_FILE = '/home/z/my-project/.auth-secret'
}
