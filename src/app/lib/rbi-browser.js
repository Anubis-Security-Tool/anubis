/**
 * RBI (remote browser isolation) host — runs in the Electron main process.
 *
 * Each session is a hardened, never-shown offscreen `BrowserWindow` on its own
 * nonpersistent partition. Frames come from Chromium's offscreen renderer via
 * the `paint` event (encoded to JPEG with `NativeImage.toJPEG`), and semantic
 * input is replayed with `webContents.sendInputEvent`. Hardening mirrors
 * `./embedded-website.js`.
 *
 * We deliberately do NOT attach the CDP debugger: on Windows, attaching the
 * debugger to an actively compositing offscreen renderer deadlocks the very
 * first `Page.enable`, so the documented offscreen paint/sendInputEvent path is
 * used instead.
 *
 * We also never `destroy()` an offscreen window at runtime: on this Electron
 * build the offscreen renderer teardown segfaults the whole process ~1s later
 * (a native crash we cannot catch). Instead closed sessions are "parked" —
 * blanked to about:blank, paint silenced, and storage cleared — and the hidden
 * window is returned to a bounded warm pool for reuse, so resources stay capped
 * at `maxSessions` without a destroy crash. Dependencies are injectable for
 * testing.
 */

const { randomUUID } = require('node:crypto')

const DEFAULT_MAX_SESSIONS = 8
const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000
const DEFAULT_FRAME_RATE = 15
const DEFAULT_JPEG_QUALITY = 60
const MAX_DIMENSION = 4096

const SPECIAL_KEYS = new Set([
  'Enter', 'Tab', 'Backspace', 'Delete', 'Escape', 'ArrowUp', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Insert'
])

// Every storage class Chromium exposes to clearStorageData. Enumerated
// explicitly so a reused window cannot carry a prior session's cookies,
// local/IndexedDB state, service workers or cache storage across the pool.
const CLEARABLE_STORAGES = [
  'cookies', 'filesystem', 'indexdb', 'localstorage',
  'shadercache', 'websql', 'serviceworkers', 'cachestorage'
]

function isHttpUrl (value) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

function clampDimension (value, fallback) {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(n, MAX_DIMENSION)
}

function mouseButton (button) {
  if (button === 1) return 'middle'
  if (button === 2) return 'right'
  return 'left'
}

// client bitmask: alt=1, ctrl=2, meta=4, shift=8
function modifierList (mask) {
  const out = []
  if (mask & 1) out.push('alt')
  if (mask & 2) out.push('control')
  if (mask & 4) out.push('meta')
  if (mask & 8) out.push('shift')
  return out
}

function keyCodeFor (key) {
  if (typeof key !== 'string' || key.length === 0) return undefined
  if (key.length === 1) return key
  if (SPECIAL_KEYS.has(key)) return key
  return undefined
}

// A valid override UA is a non-empty single-line string of sane length. Line
// breaks are rejected so a crafted value cannot smuggle extra request headers.
function isValidUserAgent (value) {
  return typeof value === 'string' &&
    value.length > 0 && value.length <= 1024 &&
    !/[\r\n]/.test(value)
}

function createRbiBrowser ({
  session,
  BrowserWindow,
  onFrame,
  onEvent = () => {},
  isWebsiteUrl = isHttpUrl,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  maxSessions = DEFAULT_MAX_SESSIONS,
  idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  frameRate = DEFAULT_FRAME_RATE,
  jpegQuality = DEFAULT_JPEG_QUALITY,
  defaultUserAgent = null,
  log = console
} = {}) {
  if (!session || typeof session.fromPartition !== 'function') {
    throw new TypeError('RBI browser requires an Electron session')
  }
  if (typeof BrowserWindow !== 'function') {
    throw new TypeError('RBI browser requires BrowserWindow')
  }
  const sessions = new Map()
  const idlePool = []
  const warn = (...args) => { if (log && typeof log.warn === 'function') log.warn(...args) }

  // Fully wipe a reused session's persistent state, awaiting completion so the
  // next navigation cannot observe prior-session data. clearStorageData covers
  // cookies/local storage/etc; clearCache drops the HTTP disk+memory cache and
  // clearAuthCache drops cached HTTP credentials (NTLM/Negotiate/Basic) — both
  // of which otherwise survive clearStorageData and leak across sessions. Each
  // call is guarded so a test fake missing a method does not throw.
  async function clearSession (isolated) {
    if (!isolated) return
    try { await isolated.clearStorageData({ storages: CLEARABLE_STORAGES }) } catch {}
    try { if (typeof isolated.clearCache === 'function') await isolated.clearCache() } catch {}
    try { if (typeof isolated.clearAuthCache === 'function') await isolated.clearAuthCache() } catch {}
  }

  function touch (entry) {
    if (entry.closed) return
    if (entry.idleTimer) clearTimer(entry.idleTimer)
    entry.idleTimer = setTimer(() => close({ id: entry.id }), idleTimeoutMs)
    if (entry.idleTimer && typeof entry.idleTimer.unref === 'function') entry.idleTimer.unref()
  }

  function hardenSession (isolated) {
    isolated.setPermissionRequestHandler((_wc, _permission, done) => done(false))
    isolated.setPermissionCheckHandler(() => false)
    isolated.webRequest.onBeforeSendHeaders((details, done) => {
      const headers = { ...details.requestHeaders }
      for (const name of Object.keys(headers)) {
        const lower = name.toLowerCase()
        if (lower === 'x-anubis-managed-auth' || lower === 'x-anubis-managed-transport') {
          delete headers[name]
        }
      }
      done({ requestHeaders: headers })
    })
  }

  function wireEvents (entry) {
    const wc = entry.win.webContents
    const on = (name, fn) => { wc.on(name, fn); entry.handlers.push([name, fn]) }
    entry.onPaint = (_event, _dirty, image) => {
      if (entry.closed || !onFrame) return
      let data
      try {
        data = image.toJPEG(jpegQuality)
      } catch (error) {
        return warn('RBI frame encode failed:', error.message)
      }
      if (data && data.length) {
        onFrame(entry.id, data)
        touch(entry)
      }
    }
    on('paint', entry.onPaint)
    wc.setFrameRate(frameRate)

    const emitNav = () => onEvent(entry.id, { t: 'nav', url: wc.getURL() })
    on('did-navigate', emitNav)
    on('did-navigate-in-page', emitNav)
    on('did-start-loading', () => onEvent(entry.id, { t: 'loading', state: 'start' }))
    on('did-stop-loading', () => onEvent(entry.id, { t: 'loading', state: 'done' }))
    on('did-fail-load', (_e, code, desc, validatedURL, isMainFrame) => {
      if (isMainFrame && code !== -3) onEvent(entry.id, { t: 'error', code: desc || ('ERR_' + code) })
    })
    on('page-title-updated', (_e, title) => onEvent(entry.id, { t: 'title', title }))

    const guard = (event, target) => { if (!isWebsiteUrl(target)) event.preventDefault() }
    on('will-navigate', guard)
    on('will-redirect', guard)
    wc.setWindowOpenHandler(({ url: target }) => {
      if (isWebsiteUrl(target)) wc.loadURL(target).catch(() => {})
      return { action: 'deny' }
    })
  }

  function unwireEvents (entry) {
    const wc = entry.win.webContents
    try {
      for (const [name, fn] of entry.handlers) wc.removeListener(name, fn)
    } catch {}
    entry.handlers = []
    entry.onPaint = null
    try { wc.setWindowOpenHandler(() => ({ action: 'deny' })) } catch {}
  }

  function createWindowCtx (w, h) {
    const partition = 'anubis-rbi-' + randomUUID()
    const isolated = session.fromPartition(partition)
    // A realistic default UA set at the session level drives both the HTTP
    // User-Agent header and navigator.userAgent, hiding the Electron/anubis
    // tokens. Per-session overrides are applied later in open().
    if (isValidUserAgent(defaultUserAgent) && typeof isolated.setUserAgent === 'function') {
      try { isolated.setUserAgent(defaultUserAgent) } catch {}
    }
    hardenSession(isolated)
    const win = new BrowserWindow({
      show: false,
      width: w,
      height: h,
      webPreferences: {
        offscreen: true,
        partition,
        session: isolated,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        nodeIntegrationInWorker: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        devTools: false,
        enableRemoteModule: false,
        spellcheck: false,
        backgroundThrottling: false,
        additionalArguments: []
      }
    })
    return { partition, isolated, win }
  }

  // Offscreen windows cannot be destroyed at runtime without segfaulting, so a
  // closed session's hidden window is recycled: a reused window gets its prior
  // storage cleared, keeping sequential sessions isolated within the cap.
  function acquireWindowCtx (w, h) {
    const pooled = idlePool.pop()
    if (pooled) {
      try { pooled.win.setContentSize(w, h) } catch {}
      return { ...pooled, fromPool: true }
    }
    return { ...createWindowCtx(w, h), fromPool: false }
  }

  function park (entry) {
    const { win, isolated } = entry
    unwireEvents(entry)
    if (win.isDestroyed()) return
    const wc = win.webContents
    try { if (!wc.isDestroyed()) wc.loadURL('about:blank').catch(() => {}) } catch {}
    if (idlePool.length < maxSessions) {
      idlePool.push({ partition: entry.partition, isolated, win })
    }
    // Best-effort clear on park; the authoritative wipe happens before reuse in
    // open(). Pool push stays synchronous so callers observe poolSize at once.
    return clearSession(isolated)
  }

  async function open ({ id, url, width, height, dpr, userAgent } = {}) {
    if (typeof id !== 'string' || !id) throw new Error('Invalid browser session id')
    const existing = sessions.get(id)
    if (existing) {
      if (url && isWebsiteUrl(url)) existing.win.webContents.loadURL(url).catch(() => {})
      touch(existing)
      return { id }
    }
    if (!isWebsiteUrl(url)) throw new Error('Only http(s) targets are allowed')
    if (sessions.size >= maxSessions) throw new Error('Too many browser sessions')
    const w = clampDimension(width, 1280)
    const h = clampDimension(height, 720)
    const ctx = acquireWindowCtx(w, h)
    const entry = {
      id,
      partition: ctx.partition,
      isolated: ctx.isolated,
      win: ctx.win,
      width: w,
      height: h,
      dpr: Number(dpr) > 0 ? Number(dpr) : 1,
      idleTimer: null,
      closed: false,
      onPaint: null,
      handlers: []
    }
    sessions.set(id, entry)
    try {
      wireEvents(entry)
      if (ctx.fromPool) {
        // Reused window: wipe the prior session's state and reset per-session
        // visual state before the new page loads, so B never shares A's data.
        try { ctx.win.webContents.setZoomLevel(0) } catch {}
        await clearSession(ctx.isolated)
      }
      // Per-session UA override wins over defaultUserAgent. The effective UA is
      // applied to both the session (HTTP header + navigator) and the
      // webContents, and crucially before loadURL so the very first request
      // carries it. It is re-applied on every open so a pool-reused window never
      // keeps the previous session's override: when no override is given, the
      // default is reasserted, preventing UA from leaking across sessions.
      const effectiveUserAgent = isValidUserAgent(userAgent)
        ? userAgent
        : (isValidUserAgent(defaultUserAgent) ? defaultUserAgent : null)
      if (effectiveUserAgent) {
        try { if (typeof ctx.isolated.setUserAgent === 'function') ctx.isolated.setUserAgent(effectiveUserAgent) } catch {}
        try { if (typeof ctx.win.webContents.setUserAgent === 'function') ctx.win.webContents.setUserAgent(effectiveUserAgent) } catch {}
      }
      await ctx.win.webContents.loadURL(url)
    } catch (error) {
      if (error && error.code === 'ERR_ABORTED') {
        // superseded navigation; keep the session
      } else {
        close({ id })
        throw error
      }
    }
    touch(entry)
    return { id }
  }

  async function input ({ id, t, kind, x, y, button, buttons, clickCount, modifiers, dx, dy, key } = {}) {
    const entry = sessions.get(id)
    if (!entry || entry.closed) return
    const wc = entry.win.webContents
    const mods = modifierList(modifiers || 0)
    touch(entry)
    if (t === 'mouse') {
      if (kind === 'wheel') {
        return wc.sendInputEvent({
          type: 'mouseWheel',
          x: x || 0,
          y: y || 0,
          deltaX: dx || 0,
          deltaY: dy || 0,
          canScroll: true,
          modifiers: mods
        })
      }
      const type = kind === 'down' ? 'mouseDown' : kind === 'up' ? 'mouseUp' : 'mouseMove'
      const event = { type, x: x || 0, y: y || 0, modifiers: mods }
      if (kind === 'down' || kind === 'up') {
        event.button = mouseButton(button)
        event.clickCount = clickCount || 1
      }
      return wc.sendInputEvent(event)
    }
    if (t === 'key') {
      const keyCode = keyCodeFor(key)
      if (kind === 'char') {
        if (keyCode) wc.sendInputEvent({ type: 'char', keyCode, modifiers: mods })
        return
      }
      if (!keyCode) return
      wc.sendInputEvent({ type: kind === 'up' ? 'keyUp' : 'keyDown', keyCode, modifiers: mods })
    }
  }

  async function resize ({ id, width, height, dpr } = {}) {
    const entry = sessions.get(id)
    if (!entry || entry.closed) return
    entry.width = clampDimension(width, entry.width)
    entry.height = clampDimension(height, entry.height)
    if (Number(dpr) > 0) entry.dpr = Number(dpr)
    touch(entry)
    entry.win.setContentSize(entry.width, entry.height)
    entry.win.webContents.invalidate()
  }

  async function nav ({ id, action, url } = {}) {
    const entry = sessions.get(id)
    if (!entry || entry.closed) return
    const wc = entry.win.webContents
    touch(entry)
    if (action === 'goto' && url && isWebsiteUrl(url)) {
      wc.loadURL(url).catch(() => {})
    } else if (action === 'reload') {
      wc.reload()
    } else if (action === 'back' && wc.canGoBack && wc.canGoBack()) {
      wc.goBack()
    } else if (action === 'forward' && wc.canGoForward && wc.canGoForward()) {
      wc.goForward()
    }
  }

  function close ({ id } = {}) {
    const entry = sessions.get(id)
    if (!entry) return
    sessions.delete(id)
    entry.closed = true
    if (entry.idleTimer) clearTimer(entry.idleTimer)
    Promise.resolve(park(entry)).catch(() => {})
  }

  function disposeAll () {
    for (const id of [...sessions.keys()]) close({ id })
  }

  // Export every cookie in a live session's isolated jar as a plain array, so an
  // authenticated session can be carried to another session.
  async function exportCookies ({ id } = {}) {
    const entry = sessions.get(id)
    if (!entry || entry.closed) throw new Error('Browser session not found')
    if (!entry.isolated.cookies || typeof entry.isolated.cookies.get !== 'function') return []
    return entry.isolated.cookies.get({})
  }

  // Load an array of previously exported cookies into a live session's jar. Each
  // cookie is best-effort: a malformed entry is skipped rather than aborting the
  // whole import. Returns the number of cookies successfully set.
  async function importCookies ({ id, cookies } = {}) {
    const entry = sessions.get(id)
    if (!entry || entry.closed) throw new Error('Browser session not found')
    if (!entry.isolated.cookies || typeof entry.isolated.cookies.set !== 'function') return 0
    if (!Array.isArray(cookies)) return 0
    let count = 0
    for (const cookie of cookies) {
      try {
        if (!cookie || typeof cookie.name !== 'string' || !cookie.name) continue
        const bareDomain = String(cookie.domain || '').replace(/^\./, '')
        if (!bareDomain) continue
        const path = cookie.path || '/'
        const scheme = cookie.secure ? 'https' : 'http'
        const details = {
          url: `${scheme}://${bareDomain}${path}`,
          name: cookie.name,
          value: typeof cookie.value === 'string' ? cookie.value : '',
          domain: cookie.domain,
          path,
          secure: !!cookie.secure,
          httpOnly: !!cookie.httpOnly
        }
        if (typeof cookie.expirationDate === 'number') details.expirationDate = cookie.expirationDate
        if (cookie.sameSite) details.sameSite = cookie.sameSite
        await entry.isolated.cookies.set(details)
        count++
      } catch {}
    }
    return count
  }

  return {
    open,
    input,
    resize,
    nav,
    close,
    exportCookies,
    importCookies,
    disposeAll,
    count: () => sessions.size,
    poolSize: () => idlePool.length,
    _sessions: sessions
  }
}

module.exports = { createRbiBrowser, isHttpUrl }
