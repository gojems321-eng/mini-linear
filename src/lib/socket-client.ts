'use client'

import { io, type Socket } from 'socket.io-client'

/**
 * Singleton socket.io connection for the browser.
 *
 * URL resolution:
 * - Default `/?XTransformPort=3003` targets the hosted-sandbox gateway, which
 *   routes that path to the realtime mini-service on port 3003.
 * - Set NEXT_PUBLIC_REALTIME_URL (inlined at build time) to point somewhere
 *   else — e.g. a dedicated realtime host on Vercel/Fly. When no realtime
 *   server exists in the deployment, the connection simply fails and the
 *   board falls back to 15s polling automatically, so this is safe to leave
 *   unset for a first Vercel deploy.
 */
const REALTIME_URL = process.env.NEXT_PUBLIC_REALTIME_URL ?? '/?XTransformPort=3003'

let socket: Socket | null = null

export function getRealtimeSocket(): Socket {
  if (!socket) {
    socket = io(REALTIME_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      timeout: 10000,
    })
  }
  return socket
}
