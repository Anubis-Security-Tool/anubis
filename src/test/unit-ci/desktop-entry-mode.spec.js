const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function launch (args, installed = true) {
  const calls = []
  const env = {}
  const app = { exit: code => calls.push(['exit', code]) }
  const source = fs.readFileSync(path.join(__dirname, '../../app/app.js'), 'utf8')
  vm.runInNewContext(source, {
    process: { argv: ['anubis.exe', ...args], platform: 'win32', execPath: 'C:\\Program Files\\Anubis-Security-Tool\\anubis.exe', env, exit: code => calls.push(['exit', code]) },
    require: name => {
      if (name === 'path') return path.win32
      if (name === 'fs') return { existsSync: () => installed }
      if (name === 'electron') return { app, dialog: { showErrorBox: () => calls.push(['error']) } }
      if (name === './lib/machine-client-entry') return { startMachineClient: () => { calls.push(['machine-client']); return Promise.resolve() } }
      if (name === './common/log') return { debug () {}, error () {} }
      if (name === './lib/create-app') return { createApp: () => { calls.push(['desktop']); return Promise.resolve() } }
      if (name === './lib/glob-state') return { set () {} }
      if (name === './common/brand') return { id: 'anubis', name: 'Anubis-Security-Tool' }
      throw new Error('Unexpected module: ' + name)
    }
  })
  return { calls, env }
}

test('the installed application opens the original Desktop rather than an embedded Web machine client', () => {
  const result = launch([])
  assert.deepEqual(result.calls, [['desktop']])
  assert.equal(result.env.ANUBIS_ADMIN_MANAGED_ENABLED, '0')
})

test('the machine workspace client is opt-in and the standalone flag still opens Desktop', () => {
  assert.deepEqual(launch(['--anubis-machine-client']).calls, [['machine-client']])
  assert.deepEqual(launch(['--standalone']).calls, [['desktop']])
  const portable = launch([], false)
  assert.deepEqual(portable.calls, [['desktop']])
  assert.equal(portable.env.ANUBIS_ADMIN_MANAGED_ENABLED, undefined)
})
