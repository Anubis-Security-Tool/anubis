const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { spawn } = require('node:child_process')
const { once } = require('node:events')

const filename = path.resolve(__dirname, '../../app/server/session-local.js')
const marker = 'EARLY_LOCAL_TERMINAL_MARKER\n'

function loadLocal (terminal) {
  const sessions = new Map()
  class TerminalBase {
    constructor (options) {
      this.initOptions = options
      this.pid = 'local-startup-test'
    }

    onEndConn () {
      sessions.delete(this.pid)
    }
  }
  const module = { exports: {} }
  const mocks = {
    path,
    './session-base': { TerminalBase },
    './global-state': { setSession: (id, value) => sessions.set(id, value) },
    'node-pty': { spawn: () => terminal }
  }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    exports: module.exports,
    require (name) {
      assert(Object.hasOwn(mocks, name), 'Unexpected dependency: ' + name)
      return mocks[name]
    },
    process
  }, { filename })
  return { api: module.exports, sessions }
}

function options () {
  return {
    execWindows: 'System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    execLinux: '/bin/bash',
    execMac: '/bin/bash',
    execWindowsArgs: [],
    execLinuxArgs: [],
    execMacArgs: []
  }
}

async function fixture (t) {
  const child = spawn(process.execPath, ['-e', `
    process.stdout.write(${JSON.stringify(marker)}, () => process.send('emitted'));
    process.stdin.on('data', data => process.stdout.write(data));
    process.on('message', message => { if (message === 'stop') process.exit(0) });
  `], { stdio: ['pipe', 'pipe', 'pipe', 'ipc'], windowsHide: true })
  const emitted = once(child, 'message')
  const exited = once(child, 'exit')
  const counts = { pause: 0, resume: 0, kill: 0 }
  // A PTY starts flowing before the WebSocket consumer has attached.
  child.stdout.resume()
  const terminal = {
    pause () { counts.pause++; child.stdout.pause() },
    resume () { counts.resume++; child.stdout.resume() },
    on (event, callback) {
      if (event === 'data') child.stdout.on(event, callback)
      else child.on(event, callback)
    },
    removeListener (event, callback) {
      if (event === 'data') child.stdout.removeListener(event, callback)
      else child.removeListener(event, callback)
    },
    kill () {
      counts.kill++
      if (child.connected) child.send('stop')
    }
  }
  t.after(async () => {
    if (child.exitCode === null && child.connected) child.send('stop')
    let timer
    try {
      await Promise.race([
        exited,
        new Promise((resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Owned terminal fixture did not stop')), 2000)
        })
      ])
    } finally { clearTimeout(timer) }
  })
  return { child, emitted, exited, terminal, counts }
}

test('local PTY startup output waits for its first data consumer', { timeout: 5000 }, async t => {
  const { child, emitted, terminal, counts } = await fixture(t)
  const { api } = loadLocal(terminal)
  const session = await api.session(options())
  assert.equal(counts.pause, 1)
  session.on('exit', () => {})
  assert.equal(counts.resume, 0)
  await emitted
  const data = []
  const received = new Promise(resolve => {
    session.on('data', chunk => {
      data.push(chunk)
      if (Buffer.concat(data).includes(Buffer.from('AFTER_ATTACH\n'))) resolve()
    })
  })
  child.stdin.write('AFTER_ATTACH\n')
  await received
  assert.equal(Buffer.concat(data).toString(), marker + 'AFTER_ATTACH\n')
  assert.equal(counts.resume, 1)
  session.on('data', () => {})
  assert.equal(counts.resume, 1)
})

test('a paused local PTY can be closed before its consumer connects', { timeout: 5000 }, async t => {
  const { emitted, exited, terminal, counts } = await fixture(t)
  const { api, sessions } = loadLocal(terminal)
  const session = await api.session(options())
  await emitted
  session.kill()
  await exited
  assert.equal(counts.pause, 1)
  assert.equal(counts.resume, 0)
  assert.equal(counts.kill, 1)
  assert.equal(sessions.size, 0)
})
