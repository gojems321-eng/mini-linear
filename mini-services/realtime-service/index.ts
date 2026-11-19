/**
 * Realtime fan-out service for Mini-Linear.
 *
 * Port 3003 — socket.io (path "/"). The Caddy gateway forwards browser
 * connections from `/...?XTransformPort=3003` here. socket.io claims every
 * request on this port, so nothing else may share it.
 *
 * Port 3004 — localhost-only HTTP relay for the Next.js server:
 *   POST /emit  { rooms: string[], event: string, data: unknown }
 *   GET  /health
 *
 * Rooms:
 *   project:<projectId>   board + issue timeline updates
 *   workspace:<wsId>      members / projects updates
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { Server } from 'socket.io'
import type { Socket } from 'socket.io'

const SOCKET_PORT = 3003
const EMIT_PORT = 3004
const MAX_ROOMS_PER_SOCKET = 10
const ROOM_PATTERN = /^(project|workspace):[A-Za-z0-9_-]{1,64}$/
const EVENT_PATTERN = /^[a-zA-Z][a-zA-Z0-9_.:-]{0,39}$/

const socketHttpServer = createServer()

const io = new Server(socketHttpServer, {
  // DO NOT change the path, it is used by Caddy to forward the request to the correct port
  path: '/',
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
})

io.on('connection', (socket: Socket) => {
  console.log(`socket connected: ${socket.id}`)

  socket.on('join', (payload: { rooms?: unknown }) => {
    const rooms = Array.isArray(payload?.rooms) ? payload.rooms : []
    for (const room of rooms.slice(0, MAX_ROOMS_PER_SOCKET)) {
      if (typeof room === 'string' && ROOM_PATTERN.test(room)) {
        void socket.join(room)
        console.log(`socket ${socket.id} joined ${room}`)
      }
    }
  })

  socket.on('leave', (payload: { rooms?: unknown }) => {
    const rooms = Array.isArray(payload?.rooms) ? payload.rooms : []
    for (const room of rooms.slice(0, MAX_ROOMS_PER_SOCKET)) {
      if (typeof room === 'string' && ROOM_PATTERN.test(room)) {
        void socket.leave(room)
      }
    }
  })

  socket.on('disconnect', (reason) => {
    console.log(`socket disconnected: ${socket.id} (${reason})`)
  })

  socket.on('error', (error) => {
    console.error(`socket error (${socket.id}):`, error)
  })
})

socketHttpServer.listen(SOCKET_PORT, () => {
  console.log(`realtime-service socket.io listening on port ${SOCKET_PORT}`)
})

/* --------------------------- localhost emit relay -------------------------- */

function isLocalAddress(raw: string | undefined): boolean {
  if (!raw) return false
  const address = raw.replace(/^::ffff:/, '')
  return address === '127.0.0.1' || address === '::1'
}

function sendJson(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage, limit = 64 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('payload too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const emitServer = createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
    sendJson(res, 200, { ok: true, service: 'realtime-service' })
    return
  }

  if (req.method === 'POST' && req.url === '/emit') {
    if (!isLocalAddress(req.socket.remoteAddress)) {
      sendJson(res, 403, { ok: false, error: 'local calls only' })
      return
    }
    void readBody(req)
      .then((raw) => {
        const parsed = JSON.parse(raw) as { rooms?: unknown; event?: unknown; data?: unknown }

        const rooms = Array.isArray(parsed.rooms)
          ? parsed.rooms.filter((r): r is string => typeof r === 'string' && ROOM_PATTERN.test(r)).slice(0, 20)
          : []
        const event =
          typeof parsed.event === 'string' && EVENT_PATTERN.test(parsed.event) ? parsed.event : null

        if (rooms.length === 0 || !event) {
          sendJson(res, 400, { ok: false, error: 'invalid rooms or event' })
          return
        }

        for (const room of rooms) {
          io.to(room).emit(event, parsed.data ?? null)
        }
        console.log(`emit ${event} -> [${rooms.join(', ')}]`)
        sendJson(res, 200, { ok: true, delivered: rooms.length })
      })
      .catch(() => sendJson(res, 400, { ok: false, error: 'bad request' }))
    return
  }

  sendJson(res, 404, { ok: false, error: 'not found' })
})

emitServer.listen(EMIT_PORT, '127.0.0.1', () => {
  console.log(`realtime-service emit relay listening on 127.0.0.1:${EMIT_PORT}`)
})

process.on('SIGTERM', () => {
  socketHttpServer.close(() => process.exit(0))
  emitServer.close()
})
process.on('SIGINT', () => {
  socketHttpServer.close(() => process.exit(0))
  emitServer.close()
})
