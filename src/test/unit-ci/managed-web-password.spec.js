const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createManagedWebPassword } = require('../../app/lib/managed-web-password')
const { createBrowserRpc } = require('../../app/lib/managed-browser-rpc')

test('each profile gets its own initial Web password and local file edits change subsequent authentication', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anubis-web-password-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const first = path.join(root, 'first')
  const second = path.join(root, 'second')
  fs.mkdirSync(first)
  fs.mkdirSync(second)
  const a = createManagedWebPassword(first)
  const b = createManagedWebPassword(second)
  const initial = fs.readFileSync(a.file, 'utf8').trim()
  assert.match(initial, /^[a-zA-Z0-9_-]{32}$/)
  assert.notEqual(initial, fs.readFileSync(b.file, 'utf8').trim())
  assert.equal(a.verify(initial), true)
  assert.equal(a.verify('wrong-password'), false)
  fs.writeFileSync(a.file, 'local-file-password-change\r\n')
  assert.equal(a.verify(initial), false)
  assert.equal(a.verify('local-file-password-change'), true)
  assert.equal(createManagedWebPassword(first).verify('local-file-password-change'), true)
  fs.writeFileSync(a.file, '')
  assert.throws(() => a.verify(initial), /12 to 4096/)
  fs.writeFileSync(a.file, 'first-password-line\nsecond-line')
  assert.throws(() => createManagedWebPassword(first).verify('first-password-line'), /one line/)
  fs.unlinkSync(a.file)
  assert.throws(() => a.verify(initial), { code: 'ENOENT' })
})

test('hardlinked credential files fail closed without replacing the existing password', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anubis-web-password-link-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const manager = createManagedWebPassword(root)
  const bytes = fs.readFileSync(manager.file)
  fs.linkSync(manager.file, path.join(root, 'other.txt'))
  assert.throws(() => manager.verify(bytes.toString().trim()), /unavailable/)
  assert.throws(() => createManagedWebPassword(root), /unavailable/)
  assert.deepEqual(fs.readFileSync(manager.file), bytes)
})

test('only verified Web-user passwords or internal administrator assertions authorize the protected workspace', async () => {
  const authorized = []
  const rpc = createBrowserRpc({
    functions: {},
    getConfig: () => ({}),
    getPassword: async () => ({ hashedPassword: 'native-password-is-not-replaced' }),
    constants: () => ({}),
    init: async () => ({}),
    webPassword: { verify: value => value === 'local-file-password' },
    onAuthorizedWebLogin: async () => { authorized.push(true) }
  })
  assert.equal(await rpc('browserUserLogin', ['wrong-password']), false)
  assert.equal(await rpc('browserRoleLogin', ['user']), false)
  assert.equal(await rpc('browserRoleLogin', ['administrator', 'extra']), false)
  assert.deepEqual(authorized, [])
  assert.equal(await rpc('browserUserLogin', ['local-file-password']), true)
  assert.equal(await rpc('browserRoleLogin', ['administrator']), true)
  assert.equal(authorized.length, 2)
})

test('an administrator-provisioned Web user password atomically replaces the local file and verifies', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anubis-web-password-set-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const manager = createManagedWebPassword(root)
  const initial = fs.readFileSync(manager.file, 'utf8').trim()
  const provisioned = 'U7!vL9@zC4#kT8$w'
  manager.set(provisioned)
  assert.equal(fs.readFileSync(manager.file, 'utf8'), provisioned + '\n')
  assert.equal(manager.verify(initial), false)
  assert.equal(manager.verify(provisioned), true)
  assert.equal(createManagedWebPassword(root).verify(provisioned), true)
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(manager.file).mode & 0o777, 0o600)
  }
  assert.deepEqual(fs.readdirSync(root), ['web-user-password.txt'])
  assert.throws(() => manager.set('short'), /12 to 4096/)
  assert.throws(() => manager.set('has\nnewline-which-is-invalid'), /one line/)
  assert.equal(manager.verify(provisioned), true)
})

test('setManagedWebPassword RPC provisions through the Web password store and is gated on availability', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anubis-web-password-rpc-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const webPassword = createManagedWebPassword(root)
  const rpc = createBrowserRpc({
    functions: {},
    getConfig: () => ({}),
    getPassword: async () => ({}),
    constants: () => ({}),
    init: async () => ({}),
    webPassword,
    onAuthorizedWebLogin: async () => {}
  })
  const provisioned = 'U7!vL9@zC4#kT8$w'
  assert.equal(await rpc('setManagedWebPassword', [provisioned]), true)
  assert.equal(webPassword.verify(provisioned), true)
  await assert.rejects(rpc('setManagedWebPassword', []), /unavailable/)
  await assert.rejects(rpc('setManagedWebPassword', [123]), /unavailable/)

  const withoutStore = createBrowserRpc({
    functions: {},
    getConfig: () => ({}),
    getPassword: async () => ({}),
    constants: () => ({}),
    init: async () => ({}),
    onAuthorizedWebLogin: async () => {}
  })
  await assert.rejects(withoutStore('setManagedWebPassword', [provisioned]), /unavailable/)
})
