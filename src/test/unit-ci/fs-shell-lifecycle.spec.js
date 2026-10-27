const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { once } = require('node:events')

function loadFs (Bash) {
  const module = { exports: {} }
  const filename = path.resolve(__dirname, '../../app/lib/fs.js')
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    exports: module.exports,
    process,
    Buffer,
    setTimeout,
    clearTimeout,
    require (name) {
      if (name === 'node-bash') return { Bash }
      if (name === '../common/log') return { error () {} }
      if (name === '../common/runtime-constants') return { isWin: false, isMac: false }
      if (name === '../common/get-folder-size-and-file-count.js') return {}
      assert(['fs/promises', 'fs', 'path', 'util', 'child_process'].includes(name))
      return require(name)
    }
  }, { filename })
  return module.exports.fsExport
}

test('filesystem commands use the managed one-shot Bash API and preserve output', async () => {
  const calls = []
  class Bash {
    constructor () { throw new Error('Persistent shell must not be constructed by fs.run') }
    static async invoke (command, options) {
      calls.push({ command, options })
      return { stdout: Buffer.from('FS_SHELL_OUTPUT\n') }
    }
  }
  assert.equal(await loadFs(Bash).run('printf safe-fixture'), 'FS_SHELL_OUTPUT\n')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].command, 'printf safe-fixture')
  assert.equal(calls[0].options.executableOptions['--login'], true)
})

test('filesystem command failure propagates from the managed Bash API', async () => {
  const expected = new Error('Synthetic command failure')
  class Bash {
    constructor () { throw new Error('Persistent shell must not be constructed by fs.run') }
    static async invoke () { throw expected }
  }
  await assert.rejects(() => loadFs(Bash).run('synthetic-failure'), error => error === expected)
})

test('filesystem command shells naturally exit after success and failure', {
  skip: process.platform === 'win32' && 'Bash integration runs on the Linux/macOS CI jobs',
  timeout: 10000
}, async t => {
  const { Bash } = require('node-bash')
  const shells = []
  class ObservedBash extends Bash {
    constructor (options) {
      super(options)
      this.closed = once(this.process, 'close')
      shells.push(this)
    }
  }
  t.after(async () => {
    for (const shell of shells) await shell.dispose()
  })
  const value = loadFs(ObservedBash)
  assert.equal(await value.run("printf 'FS_SHELL_REAL_OK\\n'"), 'FS_SHELL_REAL_OK')
  await assert.rejects(() => value.run("printf 'synthetic-stderr' >&2"))
  assert.equal(shells.length, 2)
  await Promise.all(shells.map(shell => shell.closed))
  assert(shells.every(shell => shell.isExited))
  assert(shells.every(shell => shell.process.exitCode !== null || shell.process.signalCode !== null))
})
