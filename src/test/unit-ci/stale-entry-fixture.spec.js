const { test } = require('node:test')
const assert = require('node:assert/strict')
const { staleEntryFixture } = require('../packaged/lib/stale-entry-fixture')

for (const quote of ['"', "'", '`']) {
  test(`warm-cache fixture invalidates an actual reachable import using ${quote}`, () => {
    const target = '../chunk/electerm-5.7.6-CMTChsj6.js'
    const entry = `const boot=()=>import(${quote}${target}${quote});boot()`
    const result = staleEntryFixture(entry, '/js/electerm-5.7.6.js', [
      '/assets/js/electerm-5.7.6.js',
      '/assets/chunk/electerm-5.7.6-CMTChsj6.js'
    ])
    assert.equal(result.originalTarget, 'assets/chunk/electerm-5.7.6-CMTChsj6.js')
    assert.equal(result.removedTarget, 'assets/chunk/electerm-5.7.6-CMTChsj6-OLD_BUILD.js')
    assert.equal(result.stale, entry.replace(target, target.replace('.js', '-OLD_BUILD.js')))
    assert.notEqual(result.stale, entry)
  })
}

test('warm-cache fixture only selects archive-backed same-origin module imports', () => {
  const result = staleEntryFixture(
    'import("https://external.invalid/info-modal-1.js");import("./missing.js");import("../chunk/info-modal-1.js")',
    '/js/entry.js', ['assets\\chunk\\info-modal-1.js']
  )
  assert.equal(result.originalTarget, 'assets/chunk/info-modal-1.js')
  assert.ok(result.stale.includes('import("https://external.invalid/info-modal-1.js")'))
  assert.ok(result.stale.includes('import("./missing.js")'))
  assert.ok(result.stale.includes('import("../chunk/info-modal-1-OLD_BUILD.js")'))
})

test('warm-cache fixture rejects a stale target that is actually present', () => {
  assert.throws(() => staleEntryFixture(
    'import("../chunk/info-modal-1.js")', '/js/entry.js',
    ['assets/chunk/info-modal-1.js', 'assets/chunk/info-modal-1-OLD_BUILD.js']
  ), /target already exists/)
})

test('warm-cache fixture fails rather than silently retaining an unmodified entry', () => {
  assert.throws(() => staleEntryFixture(
    'const file="../chunk/info-modal-1.js";import(file)', '/js/entry.js', ['assets/chunk/info-modal-1.js']
  ), /no literal import/)
})

test('warm-cache fixture requires the imported module to exist in the actual archive', () => {
  assert.throws(() => staleEntryFixture(
    'import("../chunk/info-modal-absent.js")', '/js/entry.js', ['assets/chunk/unrelated.js']
  ), /no literal import/)
})

test('warm-cache fixture never selects a lazy form that navigation will not exercise', () => {
  const result = staleEntryFixture(
    'import("../chunk/quick-commands-form-1.js");import("../chunk/info-modal-1.js")',
    '/js/entry.js', ['assets/chunk/quick-commands-form-1.js', 'assets/chunk/info-modal-1.js']
  )
  assert.equal(result.originalTarget, 'assets/chunk/info-modal-1.js')
  assert.ok(result.stale.includes('import("../chunk/quick-commands-form-1.js")'))
})

test('warm-cache fixture rejects an entry with only unexercised lazy forms', () => {
  assert.throws(() => staleEntryFixture(
    'import("../chunk/quick-commands-form-1.js")', '/js/entry.js', ['assets/chunk/quick-commands-form-1.js']
  ), /no literal import/)
})
