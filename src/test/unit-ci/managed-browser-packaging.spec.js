const { test, mock } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { createHash } = require('node:crypto')
const { finished } = require('node:stream/promises')
const asar = require('@electron/asar')
const { stageBrowserAssets, verifyPackagedBrowserAssets } = require('../../build/bin/browser-assets')
mock.method(require('../../build/bin/third-party-notices'), 'verifyPackagedNotices', () => {})
mock.method(require('../../build/bin/third-party-compliance'), 'verifyPackagedCompliance', () => {})
const afterPack = require('../../build/bin/after-pack')

function fixture (t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anubis-browser-package-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const source = path.join(root, 'node_modules', 'browser-package', 'assets')
  const destination = path.join(root, 'work', 'app', 'browser-assets')
  const assets = [
    'js/basic-5.6.11.js', 'js/electerm-5.6.11.js', 'js/worker-5.6.11.js',
    'css/style-5.6.11.css', 'chunk/terminal-lazy.js',
    'assets/terminal-font.woff2', 'assets/rdp.wasm',
    'icons/file.svg', 'images/logo.png', 'third-party/index.json',
    'third-party/compliance/manifest.json', 'third-party/compliance/README.md',
    'third-party/compliance/notices/LICENSE', 'third-party/compliance/sources/source.tar.gz'
  ]
  for (const [index, entry] of assets.entries()) {
    const file = path.join(source, entry)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, Buffer.from([index, 255, 0, 127]))
  }
  const hash = bytes => createHash('sha256').update(bytes).digest('hex')
  const files = Object.fromEntries([...assets].sort().map(entry => [entry, hash(fs.readFileSync(path.join(source, entry)))]))
  const proof = {
    assets: {
      count: assets.length,
      treeSha256: hash(Object.entries(files).map(([name, hash]) => `${hash}  ${name}\n`).join('')),
      files
    }
  }
  fs.writeFileSync(path.join(path.dirname(source), 'source.json'), JSON.stringify(proof))
  fs.mkdirSync(destination, { recursive: true })
  fs.writeFileSync(path.join(destination, 'stale-chunk.js'), 'old version')
  return { root, source, destination, assets, proof }
}

test('browser package staging preserves all publisher bytes including nested compliance outside dependency cleanup', t => {
  const { root, source, destination, assets, proof } = fixture(t)
  stageBrowserAssets({ source, destination, version: '5.6.11' })
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(destination, 'manifest.json'))).assets, proof.assets)
  assert.equal(fs.existsSync(path.join(destination, 'stale-chunk.js')), false)
  fs.rmSync(path.join(root, 'node_modules'), { recursive: true })
  for (const [index, entry] of assets.entries()) {
    assert.deepEqual(fs.readFileSync(path.join(destination, entry)), Buffer.from([index, 255, 0, 127]))
  }
})

test('publisher tree mismatches fail before replacing an existing browser tree', t => {
  const { source, destination, proof } = fixture(t)
  proof.assets.treeSha256 = '0'.repeat(64)
  fs.writeFileSync(path.join(path.dirname(source), 'source.json'), JSON.stringify(proof))
  assert.throws(() => stageBrowserAssets({ source, destination, version: '5.6.11' }), /Publisher browser asset tree mismatch/)
  assert.equal(fs.readFileSync(path.join(destination, 'stale-chunk.js'), 'utf8'), 'old version')
})

test('every platform final ASAR preserves the complete publisher tree and rejects lost legal docs or extra assets', async t => {
  const { root, source, destination } = fixture(t)
  stageBrowserAssets({ source, destination, version: '5.6.11' })
  const appDir = path.dirname(destination)
  for (const platform of ['linux', 'darwin', 'win32']) {
    const out = path.join(root, 'out', platform)
    const resources = platform === 'darwin'
      ? path.join(out, 'Fixture.app', 'Contents', 'Resources')
      : path.join(out, 'resources')
    fs.mkdirSync(resources, { recursive: true })
    const archive = path.join(resources, 'app.asar')
    const context = {
      electronPlatformName: platform,
      appOutDir: out,
      packager: { info: { appDir }, appInfo: { productFilename: 'Fixture' } }
    }
    await finished(await asar.createPackage(appDir, archive))
    verifyPackagedBrowserAssets(archive, appDir)
    if (platform !== 'win32') await afterPack(context)
    const file = path.join(destination, 'third-party', 'compliance', 'README.md')
    const original = fs.readFileSync(file)
    fs.rmSync(file)
    await finished(await asar.createPackage(appDir, archive))
    fs.writeFileSync(file, original)
    await assert.rejects(afterPack(context), /Packaged browser asset tree changed/)
    const extra = path.join(destination, 'unexpected.txt')
    fs.writeFileSync(extra, 'unpublished')
    await finished(await asar.createPackage(appDir, archive))
    fs.rmSync(extra)
    await assert.rejects(afterPack(context), /Packaged browser asset tree changed/)
  }
})

test('incomplete browser packages fail staging before replacing an existing working tree', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anubis-browser-package-bad-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const source = path.join(root, 'missing-assets')
  const destination = path.join(root, 'browser-assets')
  fs.mkdirSync(destination)
  fs.writeFileSync(path.join(destination, 'working.js'), 'current')
  assert.throws(() => stageBrowserAssets({ source, destination, version: '5.6.11' }))
  assert.equal(fs.readFileSync(path.join(destination, 'working.js'), 'utf8'), 'current')
})
