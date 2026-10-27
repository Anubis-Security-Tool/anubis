const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { registerHooks } = require('node:module')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '../../..')
const build = path.join(root, 'src', 'build', 'vite')
const loaderImport = '../../client/components/terminal/xterm-loader.js'
const clientImport = '../../client/entry/electerm.jsx'

for (const fails of [false, true]) {
  test(`native cold entry ${fails ? 'surfaces an AttachAddon import failure without mounting' : 'waits for AttachAddon before mounting the unchanged client'}`, { timeout: 5000 }, async () => {
    const id = randomUUID()
    const key = Symbol.for(id)
    const state = { started: Promise.withResolvers(), ready: Promise.withResolvers(), events: [] }
    globalThis[key] = state
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
    globalThis.window = {}
    const entryUrl = pathToFileURL(path.join(build, 'electerm-entry.js')).href + '?cold=' + id
    const loaderUrl = pathToFileURL(path.join(root, 'src', 'client', 'components', 'terminal', 'xterm-loader.js')).href + '?cold=' + id
    const clientUrl = 'anubis-native-test:client-' + id
    const addonUrl = 'anubis-native-test:addon-' + id
    const hooks = registerHooks({
      resolve (specifier, context, next) {
        if (context.parentURL === entryUrl && specifier === loaderImport) {
          return { url: loaderUrl, shortCircuit: true }
        }
        if (context.parentURL === entryUrl && specifier === clientImport) {
          return { url: clientUrl, shortCircuit: true }
        }
        if (context.parentURL === loaderUrl && specifier === '@xterm/addon-attach') {
          return { url: addonUrl, shortCircuit: true }
        }
        return next(specifier, context)
      },
      load (url, context, next) {
        if (url === loaderUrl) {
          return {
            format: 'module',
            shortCircuit: true,
            source: fs.readFileSync(new URL(url), 'utf8')
          }
        }
        if (url === addonUrl) {
          return {
            format: 'module',
            shortCircuit: true,
            source: `
              const state = globalThis[Symbol.for('${id}')]
              state.events.push('attach-import-start')
              state.started.resolve()
              export const AttachAddon = await state.ready.promise
              state.events.push('attach-import-ready')
            `
          }
        }
        if (url === clientUrl) {
          return {
            format: 'module',
            shortCircuit: true,
            source: `
              const state = globalThis[Symbol.for('${id}')]
              state.events.push('client-mounted')
              state.clientAddon = window.xtermAddons.AttachAddon
            `
          }
        }
        return next(url, context)
      }
    })
    const pending = import(entryUrl)
    try {
      await Promise.race([
        state.started.promise,
        pending.then(() => { throw new Error('Client mounted before a cold AttachAddon import') })
      ])
      assert.deepEqual(state.events, ['attach-import-start'])
      assert.equal(window.xtermAddons.AttachAddon, undefined)
      if (fails) {
        const error = new Error('Controlled cold AttachAddon import failure')
        const rejection = assert.rejects(pending, actual => actual === error)
        state.ready.reject(error)
        await rejection
        assert.deepEqual(state.events, ['attach-import-start'])
        assert.equal(window.xtermAddons.AttachAddon, undefined)
      } else {
        class AttachAddon {}
        state.ready.resolve(AttachAddon)
        await pending
        assert.equal(state.clientAddon, AttachAddon)
        assert.deepEqual(state.events, ['attach-import-start', 'attach-import-ready', 'client-mounted'])
      }
    } finally {
      state.ready.resolve(class AttachAddon {})
      await pending.catch(() => {})
      hooks.deregister()
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
      else delete globalThis.window
      delete globalThis[key]
    }
  })
}

test('production and development native entries both use the cold-start bootstrap', () => {
  assert.match(fs.readFileSync(path.join(build, 'conf.js'), 'utf8'), /electerm:\s*resolve\(cwd,\s*'\.\/electerm-entry\.js'\)/)
  assert.match(fs.readFileSync(path.join(build, 'dev-server.js'), 'utf8'), /electerm:\s*'\/src\/build\/vite\/electerm-entry\.js'/)
})
