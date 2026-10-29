const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { once } = require('node:events')
const express = require('express')
const WebSocket = require('ws')
const { initManagedBrowser, HEADER } = require('../../app/server/managed-browser')
const { createBrowserRpc } = require('../../app/lib/managed-browser-rpc')

async function fixture (t, { requirePassword = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anubis-managed-browser-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(path.join(root, 'js'))
  fs.writeFileSync(path.join(root, 'js', 'basic-5.6.11.js'), 'window.browserCompanionLoaded = true')
  const app = express()
  app.use(express.json())
  require('express-ws')(app)
  const upstreamApp = express()
  require('express-ws')(upstreamApp)
  const tokens = []
  for (const type of ['terminals', 'sftp', 'transfer']) {
    upstreamApp.ws(`/${type}/:id`, (ws, req) => {
      tokens.push(req.query.token)
      ws.on('message', data => ws.send(data))
    })
  }
  const upstream = upstreamApp.listen(0, '127.0.0.1')
  await once(upstream, 'listening')
  const upstreamSockets = new Set()
  upstream.on('connection', socket => {
    upstreamSockets.add(socket)
    socket.once('close', () => upstreamSockets.delete(socket))
  })
  t.after(() => {
    for (const socket of upstreamSockets) socket.destroy()
    return new Promise(resolve => upstream.close(resolve))
  })
  const port = upstream.address().port
  let userPassword = 'web-user-password'
  const rpc = async (func, args) => {
    if (func === 'browserInfo') {
      return {
        packInfo: { version: '5.6.11' },
        brand: { name: 'Anubis' },
        requirePassword,
        config: { theme: 'dark' }
      }
    }
    if (func === 'browserLogin') return args[0] === 'desktop-password'
    if (func === 'browserUserLogin') return args[0] === userPassword
    if (func === 'browserRoleLogin') return args[0] === 'administrator'
    if (func === 'setManagedWebPassword') { userPassword = args[0]; return true }
    return createBrowserRpc({
      functions: {},
      getConfig: () => ({}),
      getPassword: async () => ({}),
      constants: () => ({}),
      init: async () => ({ config: {} })
    })(func, args)
  }
  const browser = initManagedBrowser(app, {
    secret: 'private-launch-secret',
    log: { debug () {}, warn () {} },
    assetsPath: root,
    nativeToken: 'native-terminal-token',
    rpc,
    getSessionPort: id => id === 'terminal-1' ? port : undefined
  })
  app.ws('/common/s', (ws, req) => {
    if (!req.managedSession) return ws.close(1008)
    ws.on('message', async message => {
      const request = JSON.parse(message)
      try {
        ws.send(JSON.stringify({ id: request.id, data: await req.managedRpc(request.func, request.args) }))
      } catch (error) {
        ws.send(JSON.stringify({ id: request.id, error: { message: error.message } }))
      }
    })
  })
  app.get('/', (req, res) => res.send('native desktop renderer'))
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const sockets = new Set()
  server.on('connection', socket => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  t.after(async () => {
    browser.close()
    for (const socket of sockets) socket.destroy()
    await new Promise(resolve => server.close(resolve))
  })
  const origin = `http://127.0.0.1:${server.address().port}`
  const headers = { [HEADER]: 'private-launch-secret' }
  const response = await fetch(origin, { headers })
  const html = await response.text()
  const match = /localStorage\.setItem\('tokenElecterm',"([0-9a-f]+)"\)/.exec(html)
  return { origin, root, headers, html, token: match?.[1], tokens }
}

test('real HTTP serves native renderer unchanged and managed renderer only over private transport', async t => {
  const f = await fixture(t)
  assert.equal(await (await fetch(f.origin)).text(), 'native desktop renderer')
  assert.equal((await fetch(f.origin, { headers: { [HEADER]: 'forged' } })).status, 403)
  assert.match(f.html, /Managed connectivity/)
  assert.ok(!f.html.includes('native-terminal-token'))
  assert.ok(!f.html.includes('private-launch-secret'))
  assert.match(f.token, /^[0-9a-f]{64}$/)
  const asset = await fetch(f.origin + '/js/basic-5.6.11.js', { headers: f.headers })
  assert.equal(asset.status, 200)
  assert.equal(asset.headers.get('cache-control'), 'no-store')
  assert.equal(asset.headers.get('connection'), 'close')
  assert.match(await asset.text(), /browserCompanionLoaded/)
  const constants = await fetch(f.origin + '/api/get-constants', { headers: { ...f.headers, token: f.token } })
  assert.equal(constants.status, 200)
  assert.equal((await constants.json()).config.tokenElecterm, f.token)
  for (const endpoint of ['/auth', '/mcp', '/upgrade/install', '/run']) {
    const response = await fetch(f.origin + endpoint, { headers: { ...f.headers, token: f.token } })
    assert.equal(response.status, 403)
  }
})

test('desktop password remains required after transport authentication', async t => {
  const f = await fixture(t, { requirePassword: true })
  assert.equal(f.token, undefined)
  assert.equal((await fetch(f.origin + '/api/get-constants', { headers: f.headers })).status, 401)
  const login = password => fetch(f.origin + '/api/login', {
    method: 'POST',
    headers: { ...f.headers, 'content-type': 'application/json' },
    body: JSON.stringify({ password })
  })
  assert.equal((await login('wrong')).status, 401)
  const response = await login('desktop-password')
  assert.equal(response.status, 200)
  const token = await response.json()
  assert.match(token, /^[0-9a-f]{64}$/)
  assert.equal((await fetch(f.origin + '/api/get-constants', { headers: { ...f.headers, token } })).status, 200)
})

test('Web user passwords are independent of native profile passwords and reuse authenticated bootstrap tokens', async t => {
  const unset = await fixture(t)
  const signedIn = await fetch(unset.origin + '/api/managed-password-login', {
    method: 'POST',
    headers: { ...unset.headers, 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'web-user-password' })
  })
  assert.equal(signedIn.status, 200)
  const configured = await fixture(t, { requirePassword: true })
  const login = password => fetch(configured.origin + '/api/managed-password-login', {
    method: 'POST',
    headers: { ...configured.headers, 'content-type': 'application/json' },
    body: JSON.stringify({ password })
  })
  assert.equal((await login('wrong')).status, 401)
  const response = await login('web-user-password')
  assert.equal(response.status, 200)
  const token = await response.json()
  const page = await fetch(configured.origin, { headers: { ...configured.headers, token } })
  assert.match(await page.text(), new RegExp(`localStorage\\.setItem\\('tokenElecterm',"${token}"\\)`))
})

test('managed Web user password provisioning requires private transport, validates body and rebinds authentication', async t => {
  const f = await fixture(t)
  const set = (body, headers = f.headers) => fetch(f.origin + '/api/managed-set-web-password', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  // Establish a user session on the original password.
  const original = await fetch(f.origin + '/api/managed-password-login', {
    method: 'POST',
    headers: { ...f.headers, 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'web-user-password' })
  })
  assert.equal(original.status, 200)
  const originalToken = await original.json()
  assert.equal((await fetch(f.origin + '/api/get-constants', { headers: { ...f.headers, token: originalToken } })).status, 200)
  // Transport secret is mandatory.
  assert.equal((await set({ password: 'N3w!vL9@zC4#kT8$x' }, { [HEADER]: 'forged' })).status, 403)
  // Body is strictly validated.
  assert.equal((await set({ password: 123 })).status, 400)
  assert.equal((await set({ password: 'x', extra: true })).status, 400)
  // Provision a new password.
  const provisioned = 'N3w!vL9@zC4#kT8$x'
  assert.deepEqual(await (await set({ password: provisioned })).json(), { ok: true })
  // The prior session is invalidated and the old password no longer authenticates.
  assert.equal((await fetch(f.origin + '/api/get-constants', { headers: { ...f.headers, token: originalToken } })).status, 401)
  assert.equal((await fetch(f.origin + '/api/managed-password-login', {
    method: 'POST',
    headers: { ...f.headers, 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'web-user-password' })
  })).status, 401)
  // The new password authenticates.
  const signedIn = await fetch(f.origin + '/api/managed-password-login', {
    method: 'POST',
    headers: { ...f.headers, 'content-type': 'application/json' },
    body: JSON.stringify({ password: provisioned })
  })
  assert.equal(signedIn.status, 200)
})

test('administrator grants require the private transport, exact browser binding and bounded expiry', async t => {
  const f = await fixture(t, { requirePassword: true })
  const bindingId = 'a'.repeat(64)
  const expiresAt = Date.now() + 60000
  const request = (payload, headers = {}) => fetch(f.origin + '/api/managed-role-login', {
    method: 'POST',
    headers: { ...f.headers, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload)
  })
  const payload = { role: 'administrator', bindingId, expiresAt }
  assert.equal((await request(payload)).status, 403)
  assert.equal((await request(payload, { 'x-anubis-managed-session': 'b'.repeat(64) })).status, 403)
  for (const value of [
    { ...payload, expiresAt: Date.now() - 1 },
    { ...payload, expiresAt: Date.now() + 9 * 60 * 60 * 1000 },
    { ...payload, role: 'user' },
    { ...payload, extra: true }
  ]) assert.equal((await request(value, { 'x-anubis-managed-session': bindingId })).status, 403)
  const result = await request(payload, { 'x-anubis-managed-session': bindingId })
  assert.equal(result.status, 200)
  const value = await result.json()
  assert.deepEqual(Object.keys(value).sort(), ['bindingId', 'expiresAt', 'role', 'token'])
  assert.equal(value.role, 'administrator')
  assert.equal(value.bindingId, bindingId)
  assert.equal(value.expiresAt, expiresAt)
  assert.match(value.token, /^[a-f0-9]{64}$/)
})

test('real browser WebSockets proxy text and binary using private native credentials', async t => {
  const f = await fixture(t)
  for (const [route, query] of [
    ['/terminals/terminal-1', ''],
    ['/sftp/sftp-1', '&sftpId=terminal-1'],
    ['/transfer/transfer-1', '&sftpId=sftp-1']
  ]) {
    const socket = new WebSocket(f.origin.replace('http:', 'ws:') + route + '?token=' + f.token + query, { headers: f.headers })
    await once(socket, 'open')
    const text = once(socket, 'message')
    socket.send('browser-terminal-text')
    assert.equal(String((await text)[0]), 'browser-terminal-text')
    const bytes = Buffer.from([0, 255, 16, 128])
    const binary = once(socket, 'message')
    socket.send(bytes)
    assert.deepEqual(Buffer.from((await binary)[0]), bytes)
    if (route.startsWith('/sftp/')) {
      t.after(() => socket.terminate())
    } else {
      const closed = once(socket, 'close')
      socket.close()
      await closed
    }
  }
  assert.deepEqual(f.tokens, ['native-terminal-token', 'native-terminal-token', 'native-terminal-token'])
})

test('browser RPC rejects native process control over an authenticated real WebSocket', async t => {
  const f = await fixture(t)
  const socket = new WebSocket(f.origin.replace('http:', 'ws:') + '/common/s?token=' + f.token, { headers: f.headers })
  await once(socket, 'open')
  const result = once(socket, 'message')
  socket.send(JSON.stringify({ id: 'rpc-1', func: 'restart', args: [] }))
  assert.match(JSON.parse(String((await result)[0])).error.message, /Unsupported/)
  const closed = once(socket, 'close')
  socket.close()
  await closed
})

test('browser file download and upload require authentication and preserve exact bytes', async t => {
  const f = await fixture(t)
  const source = path.join(f.root, 'download.bin')
  const content = Buffer.from([0, 1, 255, 128])
  fs.writeFileSync(source, content)
  assert.equal((await fetch(f.origin + '/api/download?path=' + encodeURIComponent(source), { headers: f.headers })).status, 401)
  const response = await fetch(f.origin + '/api/download?path=' + encodeURIComponent(source), {
    headers: { ...f.headers, token: f.token }
  })
  assert.equal(response.status, 200)
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), content)
  const form = new FormData()
  form.set('path', f.root)
  form.set('file', new Blob([content]), 'uploaded.bin')
  const upload = await fetch(f.origin + '/api/upload', {
    method: 'POST',
    headers: { ...f.headers, token: f.token },
    body: form
  })
  assert.equal(upload.status, 200)
  assert.deepEqual(fs.readFileSync(path.join(f.root, 'uploaded.bin')), content)
})
