const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { createRbiBrowser, isHttpUrl } = require('../../app/lib/rbi-browser')

function fakeImage () {
  return { toJPEG: () => Buffer.from('jpeg-bytes'), getSize: () => ({ width: 800, height: 600 }) }
}

function fixture (overrides = {}) {
  const sessions = []
  const windows = []
  const frames = []
  const events = []
  const timers = []
  const ops = []
  const session = {
    fromPartition (partition) {
      const value = {
        partition,
        setPermissionRequestHandler (fn) { this.permission = fn },
        setPermissionCheckHandler (fn) { this.check = fn },
        clearStorageData (opts) { this.cleared = (this.cleared || 0) + 1; this.lastClearOpts = opts; ops.push('clearStorageData'); return Promise.resolve() },
        clearCache () { this.cacheCleared = (this.cacheCleared || 0) + 1; ops.push('clearCache'); return Promise.resolve() },
        clearAuthCache () { this.authCleared = (this.authCleared || 0) + 1; ops.push('clearAuthCache'); return Promise.resolve() },
        webRequest: { onBeforeSendHeaders (fn) { this.headers = fn } }
      }
      sessions.push(value)
      return value
    }
  }
  class FakeBrowserWindow {
    constructor (opts) {
      this.opts = opts
      this.destroyed = false
      this.contentSize = null
      const wc = Object.assign(new EventEmitter(), {
        destroyed: false,
        frameRate: 0,
        zoomLevel: 0,
        inputs: [],
        loadURL (url) { this.lastUrl = url; this._url = url; ops.push('loadURL:' + url); return Promise.resolve() },
        getURL () { return this._url || '' },
        getTitle () { return this._title || '' },
        reload () { this.reloaded = true },
        canGoBack: () => true,
        goBack () { this.wentBack = true },
        canGoForward: () => false,
        goForward () { this.wentForward = true },
        setFrameRate (n) { this.frameRate = n },
        setZoomLevel (n) { this.zoomLevel = n },
        setWindowOpenHandler (fn) { this.popup = fn },
        sendInputEvent (e) { this.inputs.push(e) },
        invalidate () { this.invalidated = true },
        isDestroyed () { return this.destroyed }
      })
      this.webContents = wc
      this.setContentSize = (w, h) => { this.contentSize = { w, h } }
      this.isDestroyed = () => this.destroyed
      this.destroy = () => { this.destroyed = true; wc.destroyed = true }
      windows.push(this)
    }
  }
  const rbi = createRbiBrowser({
    session,
    BrowserWindow: FakeBrowserWindow,
    onFrame: (id, data) => frames.push({ id, data }),
    onEvent: (id, event) => events.push({ id, event }),
    setTimer: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t },
    clearTimer: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1) },
    log: { warn () {} },
    ...overrides
  })
  return { rbi, sessions, windows, frames, events, timers, ops, fakeImage }
}

test('isHttpUrl accepts http(s) only', () => {
  for (const url of ['https://google.com', 'http://127.0.0.1:8000/']) assert.ok(isHttpUrl(url))
  for (const url of ['file:///C:/secret', 'javascript:alert(1)', 'data:text/html,hi', 'https://', 'x']) {
    assert.equal(isHttpUrl(url), false)
  }
})

test('open creates a hardened, nonpersistent, never-shown offscreen window and loads the url', async () => {
  const f = fixture()
  await f.rbi.open({ id: 'a', url: 'https://example.org', width: 800, height: 600 })
  assert.equal(f.windows.length, 1)
  const win = f.windows[0]
  assert.equal(win.opts.show, false)
  const prefs = win.opts.webPreferences
  assert.equal(prefs.offscreen, true)
  for (const key of ['sandbox', 'contextIsolation', 'webSecurity']) assert.equal(prefs[key], true)
  for (const key of ['nodeIntegration', 'webviewTag', 'devTools']) assert.equal(prefs[key], false)
  assert.equal(prefs.preload, undefined)
  const isolated = f.sessions[0]
  assert.ok(isolated.partition.startsWith('anubis-rbi-'))
  assert.ok(!isolated.partition.startsWith('persist:'))
  assert.equal(prefs.partition, isolated.partition)
  assert.equal(isolated.check(), false)
  isolated.webRequest.headers({ requestHeaders: { 'X-Anubis-Managed-Auth': 's', 'X-Anubis-Managed-Transport': 't', Accept: 'x' } }, ({ requestHeaders }) => {
    assert.deepEqual(requestHeaders, { Accept: 'x' })
  })
  assert.equal(win.webContents.lastUrl, 'https://example.org')
  assert.ok(win.webContents.frameRate > 0)
})

test('open rejects non-http targets and enforces the session cap', async () => {
  const f = fixture({ maxSessions: 2 })
  await assert.rejects(f.rbi.open({ id: 'a', url: 'file:///C:/x' }), /http/)
  await f.rbi.open({ id: 'a', url: 'https://a.com' })
  await f.rbi.open({ id: 'b', url: 'https://b.com' })
  await assert.rejects(f.rbi.open({ id: 'c', url: 'https://c.com' }), /Too many/)
  assert.equal(f.rbi.count(), 2)
})

test('navigation guard blocks non-http will-navigate and will-redirect', async () => {
  const f = fixture()
  await f.rbi.open({ id: 'a', url: 'https://example.org' })
  const wc = f.windows[0].webContents
  let prevented = false
  wc.emit('will-navigate', { preventDefault () { prevented = true } }, 'file:///etc/passwd')
  assert.equal(prevented, true)
  prevented = false
  wc.emit('will-redirect', { preventDefault () { prevented = true } }, 'https://ok.com')
  assert.equal(prevented, false)
})

test('paint events are JPEG-encoded and forwarded as frames', async () => {
  const f = fixture()
  await f.rbi.open({ id: 'a', url: 'https://example.org' })
  const wc = f.windows[0].webContents
  wc.emit('paint', {}, { x: 0, y: 0, width: 800, height: 600 }, f.fakeImage())
  assert.equal(f.frames.length, 1)
  assert.equal(f.frames[0].id, 'a')
  assert.ok(Buffer.isBuffer(f.frames[0].data))
  assert.equal(f.frames[0].data.toString(), 'jpeg-bytes')
})

test('top-level navigation emits a nav event with the live url', async () => {
  const f = fixture()
  await f.rbi.open({ id: 'a', url: 'https://example.org' })
  const wc = f.windows[0].webContents
  wc._url = 'https://example.org/next'
  wc.emit('did-navigate', {}, 'https://example.org/next')
  assert.deepEqual(f.events.at(-1), { id: 'a', event: { t: 'nav', url: 'https://example.org/next' } })
})

test('input maps semantic events to webContents.sendInputEvent calls', async () => {
  const f = fixture()
  await f.rbi.open({ id: 'a', url: 'https://example.org' })
  const wc = f.windows[0].webContents
  wc.inputs.length = 0
  await f.rbi.input({ id: 'a', t: 'mouse', kind: 'down', x: 10, y: 20, button: 0, buttons: 1, modifiers: 8 })
  let e = wc.inputs.at(-1)
  assert.equal(e.type, 'mouseDown')
  assert.equal(e.button, 'left')
  assert.deepEqual(e.modifiers, ['shift'])
  await f.rbi.input({ id: 'a', t: 'mouse', kind: 'wheel', x: 1, y: 2, dx: -3, dy: -4 })
  e = wc.inputs.at(-1)
  assert.equal(e.type, 'mouseWheel')
  assert.equal(e.deltaY, -4)
  await f.rbi.input({ id: 'a', t: 'key', kind: 'down', key: 'Enter' })
  e = wc.inputs.at(-1)
  assert.equal(e.type, 'keyDown')
  assert.equal(e.keyCode, 'Enter')
  await f.rbi.input({ id: 'a', t: 'key', kind: 'char', key: 'q' })
  e = wc.inputs.at(-1)
  assert.equal(e.type, 'char')
  assert.equal(e.keyCode, 'q')
})

test('input is dropped for unknown sessions', async () => {
  const f = fixture()
  await f.rbi.input({ id: 'missing', t: 'mouse', kind: 'move', x: 1, y: 1 })
  assert.equal(f.frames.length, 0)
})

test('resize updates the offscreen content size and target metrics', async () => {
  const f = fixture()
  await f.rbi.open({ id: 'a', url: 'https://example.org', width: 800, height: 600 })
  await f.rbi.resize({ id: 'a', width: 1024, height: 768 })
  assert.deepEqual(f.windows[0].contentSize, { w: 1024, h: 768 })
  assert.equal(f.windows[0].webContents.invalidated, true)
})

test('close parks the window without destroying it and stops forwarding frames', async () => {
  const f = fixture()
  await f.rbi.open({ id: 'a', url: 'https://example.org' })
  const win = f.windows[0]
  f.rbi.close({ id: 'a' })
  // offscreen windows segfault on destroy, so a closed session is parked, not destroyed
  assert.equal(win.isDestroyed(), false)
  assert.equal(win.webContents.lastUrl, 'about:blank')
  assert.equal(f.sessions[0].cleared, 1)
  assert.equal(win.webContents.listenerCount('paint'), 0)
  assert.equal(f.rbi.count(), 0)
  assert.equal(f.rbi.poolSize(), 1)
  // a late paint after close must not forward a frame
  win.webContents.emit('paint', {}, {}, f.fakeImage())
  assert.equal(f.frames.length, 0)
})

test('the next open recycles a parked window instead of allocating a new one', async () => {
  const f = fixture()
  await f.rbi.open({ id: 'a', url: 'https://a.com' })
  f.rbi.close({ id: 'a' })
  assert.equal(f.windows.length, 1)
  await f.rbi.open({ id: 'b', url: 'https://b.com' })
  assert.equal(f.windows.length, 1)
  assert.equal(f.rbi.poolSize(), 0)
  assert.equal(f.windows[0].webContents.lastUrl, 'https://b.com')
  // reused session still forwards frames under the new id
  f.windows[0].webContents.emit('paint', {}, {}, f.fakeImage())
  assert.equal(f.frames.at(-1).id, 'b')
})

test('reuse wipes storage, http cache and auth cache before the new session navigates', async () => {
  const f = fixture()
  await f.rbi.open({ id: 'a', url: 'https://a.com' })
  f.rbi.close({ id: 'a' })
  // let park()'s best-effort async clear settle, then isolate the reuse path
  await new Promise(resolve => setImmediate(resolve))
  const pooled = f.sessions[0]
  f.ops.length = 0
  await f.rbi.open({ id: 'b', url: 'https://b.com' })
  // same pooled window was reused (no new allocation)
  assert.equal(f.windows.length, 1)
  const iStorage = f.ops.indexOf('clearStorageData')
  const iCache = f.ops.indexOf('clearCache')
  const iAuth = f.ops.indexOf('clearAuthCache')
  const iLoad = f.ops.indexOf('loadURL:https://b.com')
  // all three wipes happened on reuse
  assert.ok(iStorage >= 0, 'clearStorageData called on reuse')
  assert.ok(iCache >= 0, 'clearCache called on reuse')
  assert.ok(iAuth >= 0, 'clearAuthCache called on reuse')
  // and every wipe completed strictly before B navigated
  assert.ok(iLoad >= 0, 'new session navigated')
  assert.ok(iStorage < iLoad, 'storage wiped before navigation')
  assert.ok(iCache < iLoad, 'http cache wiped before navigation')
  assert.ok(iAuth < iLoad, 'auth cache wiped before navigation')
  // full storage class list was requested, not a partial clear
  assert.deepEqual(pooled.lastClearOpts.storages, [
    'cookies', 'filesystem', 'indexdb', 'localstorage',
    'shadercache', 'websql', 'serviceworkers', 'cachestorage'
  ])
  // per-session zoom was reset on the reused window
  assert.equal(f.windows[0].webContents.zoomLevel, 0)
})

test('idle timeout parks the session and clears timers', async () => {
  const f = fixture({ idleTimeoutMs: 1000 })
  await f.rbi.open({ id: 'a', url: 'https://example.org' })
  assert.equal(f.rbi.count(), 1)
  f.timers.at(-1).fn()
  assert.equal(f.rbi.count(), 0)
  assert.equal(f.windows[0].isDestroyed(), false)
})

test('disposeAll parks every live session into the pool', async () => {
  const f = fixture()
  await f.rbi.open({ id: 'a', url: 'https://a.com' })
  await f.rbi.open({ id: 'b', url: 'https://b.com' })
  assert.equal(f.rbi.count(), 2)
  f.rbi.disposeAll()
  assert.equal(f.rbi.count(), 0)
  assert.equal(f.rbi.poolSize(), 2)
  for (const w of f.windows) assert.equal(w.isDestroyed(), false)
})
