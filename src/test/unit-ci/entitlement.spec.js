const { test } = require('node:test')
const assert = require('node:assert/strict')
const { isEntitled } = require('../../client/common/entitlement')

test('isEntitled: pro true with no expiry is entitled', () => {
  assert.equal(isEntitled({ pro: true, proExpiresAt: null }), true)
  assert.equal(isEntitled({ pro: true }), true)
})

test('isEntitled: pro true with a future expiry is entitled', () => {
  assert.equal(isEntitled({ pro: true, proExpiresAt: Date.now() + 60000 }), true)
})

test('isEntitled: pro true with a past expiry is not entitled', () => {
  assert.equal(isEntitled({ pro: true, proExpiresAt: Date.now() - 60000 }), false)
})

test('isEntitled: pro false is not entitled', () => {
  assert.equal(isEntitled({ pro: false, proExpiresAt: null }), false)
  assert.equal(isEntitled({ pro: false, proExpiresAt: Date.now() + 60000 }), false)
})

test('isEntitled: missing/undefined/null status is not entitled', () => {
  assert.equal(isEntitled(undefined), false)
  assert.equal(isEntitled(null), false)
  assert.equal(isEntitled({}), false)
  assert.equal(isEntitled({ status: 'offline' }), false)
})
