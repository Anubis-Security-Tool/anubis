/**
 * RBI (remote browser isolation) bridge — runs in the forked server child.
 *
 * The offscreen Chromium renderer can only live in the Electron main process,
 * so the `/browser/:id` WebSocket is terminated here in the child and bridged
 * to main:
 *   - control (client -> main): the child calls server-named `rbi*` functions
 *     over the existing managed-rpc channel. The client never names a function,
 *     so there is no arbitrary-call surface.
 *   - frames (main -> child -> client): main pushes screencast frames to this
 *     child via `serverChild.send({type:'rbi-frame', ...})`; `route()` relays
 *     them to the matching browser socket as binary.
 */

const WebSocket = require('ws')

function createRbiBridge ({ rpc, maxSockets = 16 }) {
  if (typeof rpc !== 'function') {
    throw new TypeError('RBI bridge requires a managed RPC channel')
  }
  const sockets = new Map()

  const deliver = (ws, data, binary) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(data, { binary })
  }

  return {
    register (id, ws) {
      if (typeof id !== 'string' || !id) return false
      if (!sockets.has(id) && sockets.size >= maxSockets) return false
      sockets.set(id, ws)
      return true
    },
    unregister (id) {
      sockets.delete(id)
    },
    has (id) {
      return sockets.has(id)
    },
    size () {
      return sockets.size
    },
    // main -> child -> client
    route (id, msg) {
      const ws = sockets.get(id)
      if (!ws || !msg) return false
      if (msg.type === 'rbi-frame' && typeof msg.data === 'string') {
        deliver(ws, Buffer.from(msg.data, 'base64'), true)
        return true
      }
      if (msg.type === 'rbi-event' && msg.event) {
        deliver(ws, JSON.stringify(msg.event), false)
        return true
      }
      return false
    },
    // client -> child -> main (the server names every function)
    open (id, opts) { return rpc('rbiOpen', [{ id, ...opts }]) },
    input (id, event) { return rpc('rbiInput', [{ id, ...event }]) },
    nav (id, event) { return rpc('rbiNav', [{ id, ...event }]) },
    resize (id, event) { return rpc('rbiResize', [{ id, ...event }]) },
    close (id) { return rpc('rbiClose', [{ id }]) }
  }
}

module.exports = { createRbiBridge }
