const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createRbiBridge } = require('../../app/server/rbi-bridge')

function fakeWs () {
  return { readyState: 1, sent: [], send (data, opts) { this.sent.push({ data, opts }) } }
}

test('bridge requires a managed rpc channel', () => {
  assert.throws(() => createRbiBridge({}), /managed RPC/)
})

test('register honours the socket cap and deduplicates ids', () => {
  const bridge = createRbiBridge({ rpc: () => {}, maxSockets: 2 })
  assert.equal(bridge.register('a', fakeWs()), true)
  assert.equal(bridge.register('b', fakeWs()), true)
  assert.equal(bridge.register('c', fakeWs()), false)
  // replacing an existing id is allowed even at the cap
  assert.equal(bridge.register('a', fakeWs()), true)
  assert.equal(bridge.size(), 2)
})

test('route relays frames as binary and events as json to the matching socket', () => {
  const bridge = createRbiBridge({ rpc: () => {} })
  const ws = fakeWs()
  bridge.register('a', ws)
  const payload = Buffer.from('frame').toString('base64')
  assert.equal(bridge.route('a', { type: 'rbi-frame', data: payload }), true)
  assert.ok(Buffer.isBuffer(ws.sent[0].data))
  assert.equal(ws.sent[0].data.toString(), 'frame')
  assert.equal(ws.sent[0].opts.binary, true)
  assert.equal(bridge.route('a', { type: 'rbi-event', event: { t: 'nav', url: 'https://x' } }), true)
  assert.equal(ws.sent[1].opts.binary, false)
  assert.deepEqual(JSON.parse(ws.sent[1].data), { t: 'nav', url: 'https://x' })
})

test('route drops messages for unknown ids and after unregister', () => {
  const bridge = createRbiBridge({ rpc: () => {} })
  const ws = fakeWs()
  bridge.register('a', ws)
  assert.equal(bridge.route('zzz', { type: 'rbi-frame', data: 'AA==' }), false)
  bridge.unregister('a')
  assert.equal(bridge.route('a', { type: 'rbi-frame', data: 'AA==' }), false)
  assert.equal(ws.sent.length, 0)
})

test('control methods name server-side rbi* functions with the session id', () => {
  const calls = []
  const bridge = createRbiBridge({ rpc: (func, args) => { calls.push({ func, args }); return Promise.resolve() } })
  bridge.open('a', { url: 'https://x', width: 10, height: 20 })
  bridge.input('a', { t: 'mouse', kind: 'down' })
  bridge.nav('a', { action: 'reload' })
  bridge.resize('a', { width: 5, height: 6 })
  bridge.close('a')
  assert.deepEqual(calls.map(c => c.func), ['rbiOpen', 'rbiInput', 'rbiNav', 'rbiResize', 'rbiClose'])
  assert.deepEqual(calls[0].args, [{ id: 'a', url: 'https://x', width: 10, height: 20 }])
  assert.deepEqual(calls[4].args, [{ id: 'a' }])
})
