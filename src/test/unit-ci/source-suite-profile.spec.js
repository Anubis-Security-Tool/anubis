const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { configureIsolatedUserData } = require('../../app/lib/source-suite-profile')

describe('source-suite profile isolation', () => {
  it('leaves normal profile selection unchanged without the suite env', () => {
    const calls = []
    assert.equal(configureIsolatedUserData({ setPath: (...args) => calls.push(args) }, {}), null)
    assert.deepEqual(calls, [])
  })

  it('sets only the explicit absolute suite profile path', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'anubis-suite-profile-'))
    const profile = path.join(directory, 'profile')
    const calls = []
    const env = { ANUBIS_USER_DATA_DIR: profile }
    try {
      assert.equal(configureIsolatedUserData({ setPath: (...args) => calls.push(args) }, env), profile)
      assert.deepEqual(calls, [['userData', profile]])
      assert.equal(env.DATA_PATH, profile)
      assert.ok(fs.statSync(profile).isDirectory())
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects relative paths and symlink profiles', (t) => {
    assert.throws(() => configureIsolatedUserData({ setPath () {} }, {
      ANUBIS_USER_DATA_DIR: 'relative-profile'
    }), /absolute path/)
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'anubis-suite-link-'))
    const target = path.join(directory, 'target')
    const link = path.join(directory, 'link')
    fs.mkdirSync(target)
    try {
      try {
        fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
      } catch (error) {
        if (process.platform === 'win32' && ['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
          t.skip('Windows policy does not permit creating a test junction')
          return
        }
        throw error
      }
      assert.throws(() => configureIsolatedUserData({ setPath () {} }, {
        ANUBIS_USER_DATA_DIR: link
      }), /real directory/)
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
})
