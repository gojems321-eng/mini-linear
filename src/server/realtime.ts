import 'server-only'

/**
 * Best-effort realtime relay. Server Actions POST events to the socket.io
 * mini-service, which fans them out to project/workspace rooms.
 *
 * Mutations NEVER fail because of realtime: if the service is down the error
 * is swallowed and clients catch up via query invalidation on refetch/focus.
 */

const EMIT_URL = process.env.REALTIME_SERVICE_URL ?? 'http://127.0.0.1:3004/emit'

export async function publish(rooms: string[], event: string, data: unknown): Promise<void> {
  if (rooms.length === 0) return
  try {
    const response = await fetch(EMIT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rooms, event, data }),
      signal: AbortSignal.timeout(1500),
    })
    if (!response.ok) {
      console.warn(`[realtime] emit rejected with status ${response.status}`)
    }
  } catch {
    console.warn('[realtime] emit skipped (service unreachable)')
  }
}
