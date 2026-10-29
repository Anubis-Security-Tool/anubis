const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  UA_PRESETS,
  buildProfile,
  parseProfile,
  parseCookies,
  parseVault,
  mergeVault,
  sanitizeFileBase
} = require('../../client/components/web/browser-profile')

test('UA_PRESETS exposes a blank default and a null-valued custom entry', () => {
  const def = UA_PRESETS.find(p => p.key === 'default')
  const custom = UA_PRESETS.find(p => p.key === 'custom')
  assert.equal(def.value, '')
  assert.equal(custom.value, null)
  assert.ok(UA_PRESETS.find(p => p.key === 'win-chrome').value.includes('Windows NT 10.0'))
})

test('buildProfile bundles name, user agent and cookies', () => {
  const p = buildProfile({ name: '  work  ', userAgent: 'UA/1', cookies: [{ name: 'a' }] })
  assert.deepEqual(p, { name: 'work', userAgent: 'UA/1', cookies: [{ name: 'a' }] })
})

test('buildProfile defaults a missing user agent to empty and cookies to []', () => {
  const p = buildProfile({ name: 'x' })
  assert.equal(p.userAgent, '')
  assert.deepEqual(p.cookies, [])
})

test('buildProfile throws on a blank name', () => {
  assert.throws(() => buildProfile({ name: '   ', cookies: [] }), /name is required/)
})

test('parseProfile accepts a valid bundle and normalizes it', () => {
  const bundle = parseProfile(JSON.stringify({ name: ' p ', userAgent: 'UA/2', cookies: [{ name: 'c' }] }))
  assert.deepEqual(bundle, { name: 'p', userAgent: 'UA/2', cookies: [{ name: 'c' }] })
})

test('parseProfile rejects invalid JSON, non-objects, and missing fields', () => {
  assert.throws(() => parseProfile('{not json'), /valid JSON/)
  assert.throws(() => parseProfile('[]'), /JSON object/)
  assert.throws(() => parseProfile(JSON.stringify({ cookies: [] })), /missing a name/)
  assert.throws(() => parseProfile(JSON.stringify({ name: 'p' })), /missing a cookies array/)
})

test('parseCookies returns the array or throws on non-array', () => {
  assert.deepEqual(parseCookies('[{"name":"a"}]'), [{ name: 'a' }])
  assert.throws(() => parseCookies('{}'), /JSON array/)
  assert.throws(() => parseCookies('nope'), /valid JSON/)
})

test('parseVault normalizes rows and drops unknown fields', () => {
  const rows = parseVault(JSON.stringify([
    { domain: 'a.com', username: 'u', password: 'p', extra: 1 },
    { domain: 'b.com' }
  ]))
  assert.deepEqual(rows, [
    { domain: 'a.com', username: 'u', password: 'p' },
    { domain: 'b.com', username: '', password: '' }
  ])
  assert.throws(() => parseVault('{}'), /JSON array/)
})

test('mergeVault replaces matching domain+username rows and appends new ones', () => {
  const existing = [
    { domain: 'a.com', username: 'u', password: 'old' },
    { domain: 'b.com', username: 'v', password: 'keep' }
  ]
  const incoming = [
    { domain: 'a.com', username: 'u', password: 'new' },
    { domain: 'c.com', username: 'w', password: 'add' }
  ]
  const merged = mergeVault(existing, incoming)
  assert.equal(merged.length, 3)
  assert.equal(merged.find(r => r.domain === 'a.com').password, 'new')
  assert.equal(merged.find(r => r.domain === 'b.com').password, 'keep')
  assert.ok(merged.find(r => r.domain === 'c.com'))
})

test('sanitizeFileBase strips unsafe characters and falls back', () => {
  assert.equal(sanitizeFileBase('My Work Profile!'), 'My-Work-Profile')
  assert.equal(sanitizeFileBase('  '), 'profile')
  assert.equal(sanitizeFileBase('a/b\\c'), 'a-b-c')
})
