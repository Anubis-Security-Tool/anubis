/**
 * communication between webview and app
 * run functions in seprate process, avoid using electron.remote directly
 */

const fs = require('./fs')
const log = require('../common/log')
const { Upgrade } = require('./download-upgrade')
const { transferKeys } = require('./transfer')
const fetch = require('./fetch')
const sync = require('./sync')
const {
  createTerm,
  testTerm,
  resize,
  runCmd,
  execCmd,
  toggleTerminalLog,
  toggleTerminalLogTimestamp,
  setTerminalLogPath,
  startTerminalLogFile
} = require('./terminal-api')
const globalState = require('./global-state')
const wsDec = require('./ws-dec')

const { tokenElecterm } = process.env

function verify (req) {
  if (req.managedSession) return
  const { token: to } = req.query
  if (to !== tokenElecterm) {
    throw new Error('not valid request')
  }
  if (process.env.requireAuth === 'yes' && !globalState.authed) {
    throw new Error('auth required')
  }
}

const initWs = function (app, { rbiBridge } = {}) {
  // upgrade
  app.ws('/upgrade/:id', (ws, req) => {
    verify(req)
    wsDec(ws)
    const { id } = req.params
    ws.on('close', () => {
      const inst = globalState.getUpgradeInst(id)
      if (inst) {
        inst.destroy()
      }
    })
    ws.on('message', async (message) => {
      const msg = JSON.parse(message)
      const { action } = msg

      if (action === 'upgrade-new') {
        const { id } = msg
        const opts = Object.assign({}, msg, {
          ws
        })
        const inst = new Upgrade(opts)
        globalState.setUpgradeInst(id, inst)
        await inst.init()
      } else if (action === 'upgrade-func') {
        const { id, func, args } = msg
        const inst = globalState.getUpgradeInst(id)
        if (!inst) {
          return
        }
        if (!transferKeys.includes(func) || typeof inst[func] !== 'function') {
          log.error('invalid upgrade function:', func)
          return
        }
        inst[func](...args)
      }
    })
  })

  // common functions
  app.ws('/common/s', (ws, req) => {
    verify(req)
    if (req.managedSession) {
      const expiry = setTimeout(() => ws.close(1008, 'Desktop session expired'), req.managedSession.expires - Date.now())
      ws.once('close', () => clearTimeout(expiry))
    }
    wsDec(ws)
    ws.on('message', async (message) => {
      try {
        const msg = JSON.parse(message)
        const { action } = msg
        if (action === 'runSync' && req.managedSession) {
          try {
            const data = await req.managedRpc(msg.func, msg.args)
            ws.s({ id: msg.id, data })
          } catch (error) {
            log.warn('Managed browser RPC failed:', error.message)
            ws.s({ id: msg.id, error: { message: error.message } })
          }
        } else if (action === 'fetch') {
          fetch(ws, msg)
        } else if (action === 'sync') {
          sync(ws, msg)
        } else if (action === 'fs') {
          fs(ws, msg)
        } else if (action === 'create-terminal') {
          createTerm(ws, msg)
        } else if (action === 'test-terminal') {
          testTerm(ws, msg)
        } else if (action === 'resize-terminal') {
          resize(ws, msg)
        } else if (action === 'toggle-terminal-log') {
          toggleTerminalLog(ws, msg)
        } else if (action === 'toggle-terminal-log-timestamp') {
          toggleTerminalLogTimestamp(ws, msg)
        } else if (action === 'set-terminal-log-path') {
          setTerminalLogPath(ws, msg)
        } else if (action === 'start-terminal-log-file') {
          startTerminalLogFile(ws, msg)
        } else if (action === 'run-cmd') {
          runCmd(ws, msg)
        } else if (action === 'exec-cmd') {
          execCmd(ws, msg)
        }
      } catch (err) {
        log.error('common ws error', err)
      }
    })
  })

  // RBI (remote browser isolation) stream. The offscreen Chromium lives in the
  // Electron main process, so this socket is terminated here in the child and
  // bridged to main via rbi-bridge (control over managed-rpc; frames pushed
  // back from main). Only wired when the managed RPC channel exists.
  if (rbiBridge) {
    app.ws('/browser/:id', (ws, req) => {
      verify(req)
      const { id } = req.params
      if (!rbiBridge.register(id, ws)) {
        return ws.close(1013, 'Too many browser sessions')
      }
      let expiry
      if (req.managedSession) {
        expiry = setTimeout(() => ws.close(1008, 'Desktop session expired'), req.managedSession.expires - Date.now())
      }
      ws.on('message', async (raw) => {
        if (req.managedSession && !req.managedSession.unlocked) {
          return ws.close(1008, 'Desktop authentication required')
        }
        let msg
        try {
          msg = JSON.parse(raw)
        } catch {
          return
        }
        try {
          if (msg.t === 'open') {
            await rbiBridge.open(id, { url: msg.url, width: msg.width, height: msg.height, dpr: msg.dpr })
          } else if (msg.t === 'mouse' || msg.t === 'key') {
            await rbiBridge.input(id, msg)
          } else if (msg.t === 'resize') {
            await rbiBridge.resize(id, { width: msg.width, height: msg.height, dpr: msg.dpr })
          } else if (msg.t === 'nav') {
            await rbiBridge.nav(id, { action: msg.action, url: msg.url })
          }
        } catch (err) {
          log.warn('rbi ws message failed:', err.message)
          ws.close(1011, 'Browser backend error')
        }
      })
      ws.on('close', () => {
        if (expiry) clearTimeout(expiry)
        rbiBridge.unregister(id)
        rbiBridge.close(id).catch(() => {})
      })
    })
  }
  // end
}

exports.verifyWs = verify
exports.initWs = initWs
