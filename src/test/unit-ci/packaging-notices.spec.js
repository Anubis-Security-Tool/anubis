const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const asar = require('@electron/asar')
const notices = require('../../build/bin/third-party-notices')
const afterPack = require('../../build/bin/after-pack')

function fixture (t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anubis-notices-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const write = (relative, bytes) => {
    const file = path.join(root, relative)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, bytes)
  }
  write('LICENSE', Buffer.from([0x4d, 0x49, 0x54, 0x0d, 0x0a, 0xa9]))
  write('NOTICE', 'Original upstream attribution\r\n')
  write('THIRD-PARTY-LICENSES.md', 'Original frontend attribution\n')
  write('package.json', '{"name":"fixture","version":"1.0.0"}')
  write('node_modules/@scope/frontend/package.json', '{"name":"@scope/frontend","license":"MIT"}')
  write('node_modules/@scope/frontend/test/third_party/LICENSE-MIT', 'Original frontend license\r\n')
  write('node_modules/readme-only/package.json', '{"name":"readme-only","license":"ISC"}')
  write('node_modules/readme-only/README.md', 'Original README license fallback\n')
  write('work/app/assets/js/bundle.LICENSE.txt', 'Original generated bundle notices\n')
  write('work/app/node_modules/runtime/package.json', '{"name":"runtime","license":"BSD-3-Clause"}')
  write('work/app/node_modules/runtime/LICENCE', 'Original runtime license\n')
  write('work/app/node_modules/runtime/AUTHORS', 'Original runtime authors\n')
  return { root, write, appDir: path.join(root, 'work', 'app') }
}

test('preserves original project, bundled development and runtime notices before cleanup', t => {
  const { root, appDir } = fixture(t)
  notices.captureBuildNotices(root)
  notices.captureRuntimeNotices(root)
  const dir = path.join(appDir, 'third-party-notices')
  const manifest = fs.readFileSync(path.join(dir, 'manifest.json'))
  const rows = JSON.parse(manifest).files
  assert.deepEqual(JSON.parse(manifest).readmeFallbacks, [{
    origin: 'build/node_modules/readme-only',
    readmes: ['build/node_modules/readme-only/README.md']
  }])
  for (const [origin, source] of [
    ['project/LICENSE', 'LICENSE'],
    ['project/NOTICE', 'NOTICE'],
    ['project/THIRD-PARTY-LICENSES.md', 'THIRD-PARTY-LICENSES.md'],
    ['build/node_modules/@scope/frontend/test/third_party/LICENSE-MIT', 'node_modules/@scope/frontend/test/third_party/LICENSE-MIT'],
    ['build/node_modules/readme-only/README.md', 'node_modules/readme-only/README.md'],
    ['runtime/node_modules/runtime/LICENCE', 'work/app/node_modules/runtime/LICENCE'],
    ['runtime/node_modules/runtime/AUTHORS', 'work/app/node_modules/runtime/AUTHORS'],
    ['bundles/js/bundle.LICENSE.txt', 'work/app/assets/js/bundle.LICENSE.txt']
  ]) {
    const row = rows.find(row => row.origin === origin)
    assert(row, `Missing notice: ${origin}`)
    assert.deepEqual(fs.readFileSync(path.join(dir, row.relative)), fs.readFileSync(path.join(root, source)))
  }
  notices.captureBuildNotices(root)
  notices.captureRuntimeNotices(root)
  assert.deepEqual(fs.readFileSync(path.join(dir, 'manifest.json')), manifest)
  fs.rmSync(path.join(appDir, 'node_modules'), { recursive: true })
  fs.rmSync(path.join(appDir, 'assets', 'js', 'bundle.LICENSE.txt'))
  notices.verifyNotices(root)
  fs.writeFileSync(path.join(dir, rows[0].relative), 'corrupted')
  assert.throws(() => notices.verifyNotices(root), /Notice (size|hash) mismatch/)
})

test('real final ASAR retains notices and every platform rejects missing or changed notice bytes', async t => {
  const { root, appDir } = fixture(t)
  notices.captureBuildNotices(root)
  notices.captureRuntimeNotices(root)
  const dir = path.join(appDir, 'third-party-notices')
  const rows = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'))).files
  for (const platform of ['linux', 'darwin', 'win32']) {
    const out = path.join(root, 'out', platform)
    const resources = platform === 'darwin'
      ? path.join(out, 'Fixture.app', 'Contents', 'Resources')
      : path.join(out, 'resources')
    fs.mkdirSync(resources, { recursive: true })
    const archive = path.join(resources, 'app.asar')
    await asar.createPackage(appDir, archive)
    for (const row of rows) {
      assert(asar.listPackage(archive).includes(path.join(path.sep, 'third-party-notices', row.relative)))
    }
    notices.verifyPackagedNotices(archive, appDir)
    const context = {
      electronPlatformName: platform,
      appOutDir: out,
      packager: { info: { appDir }, appInfo: { productFilename: 'Fixture' } }
    }
    if (platform !== 'win32') await afterPack(context)
    const file = path.join(dir, rows[0].relative)
    const original = fs.readFileSync(file)
    fs.writeFileSync(file, Buffer.alloc(original.length))
    await asar.createPackage(appDir, archive)
    assert.throws(() => notices.verifyPackagedNotices(archive, appDir), /Notice hash mismatch/)
    await assert.rejects(afterPack(context), /Notice hash mismatch/)
    fs.rmSync(file)
    await asar.createPackage(appDir, archive)
    assert.throws(() => notices.verifyPackagedNotices(archive, appDir), /not found/)
    fs.writeFileSync(file, original)
  }
})
