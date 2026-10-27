const { test, mock } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { createHash } = require('node:crypto')
const asar = require('@electron/asar')
const compliance = require('../../build/bin/third-party-compliance')
const notices = require('../../build/bin/third-party-notices')
mock.method(notices, 'verifyPackagedNotices', () => {})
mock.method(require('../../build/bin/browser-assets'), 'verifyPackagedBrowserAssets', () => {})
const afterPack = require('../../build/bin/after-pack')

test('the data-only compliance capsule has an exact genuine dev-dependency lock', () => {
  const root = path.resolve(__dirname, '../../..')
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')))
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json')))
  const name = '@ai-security-tool/third-party-compliance'
  assert.equal(pkg.devDependencies[name], '1.0.1')
  assert.equal(lock.packages[''].devDependencies[name], '1.0.1')
  assert.equal(lock.packages[`node_modules/${name}`].dev, true)
  assert.equal(lock.packages[`node_modules/${name}`].integrity, 'sha512-bYMWYy6y5whumyYGjzs7kaZRn1EwogaGYZNHGXxJvOZIxqEhFYmBbRIi9pQuGVBALOQ732B01FTJHARCtUVQAw==')
})

function fixture (t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anubis-compliance-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const name = '@ai-security-tool/third-party-compliance'
  const source = path.join(root, 'node_modules', name)
  fs.mkdirSync(source, { recursive: true })
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ devDependencies: { [name]: '1.0.0' } }))
  const files = {
    'package.json': Buffer.from(JSON.stringify({ name, version: '1.0.0' })),
    'README.md': Buffer.from('Original source and relink instructions\r\n'),
    'notices/COPYING.LESSER': Buffer.from('Original terms fixture\n'),
    'sources/preferred-source.tar.gz': Buffer.from([0x1f, 0x8b, 0x01, 0x00, 0xa9])
  }
  const manifest = { schemaVersion: 1, packages: [{ name: 'fixture', version: '1.0.0' }], files: [] }
  for (const [relative, bytes] of Object.entries(files)) {
    const file = path.join(source, relative)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, bytes)
    manifest.files.push({ path: relative, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
  }
  fs.writeFileSync(path.join(source, 'manifest.json'), JSON.stringify(manifest) + '\n')
  return { root, source, files, manifest, appDir: path.join(root, 'work', 'app') }
}

test('stages the complete capsule before cleanup and rejects unsafe, unindexed or changed originals', t => {
  const { root, source, files, manifest, appDir } = fixture(t)
  compliance.stageCompliance(root)
  for (const [relative, original] of Object.entries(files)) {
    assert.deepEqual(fs.readFileSync(path.join(appDir, 'third-party-compliance', relative)), original)
  }
  const originalIndex = fs.readFileSync(path.join(source, 'manifest.json'))
  assert.deepEqual(fs.readFileSync(path.join(appDir, 'third-party-compliance', 'manifest.json')), originalIndex)
  for (const unsafe of ['../escape', '/absolute', 'C:/absolute', 'notices\\escape']) {
    const invalid = structuredClone(manifest)
    invalid.files[0].path = unsafe
    fs.writeFileSync(path.join(source, 'manifest.json'), JSON.stringify(invalid))
    assert.throws(() => compliance.stageCompliance(root), /[Uu]nsafe compliance path/)
  }
  fs.writeFileSync(path.join(source, 'manifest.json'), originalIndex)
  fs.writeFileSync(path.join(source, 'extra.txt'), 'unindexed')
  assert.throws(() => compliance.stageCompliance(root), /Unindexed compliance files/)
  fs.rmSync(path.join(source, 'extra.txt'))
  fs.rmSync(path.join(root, 'node_modules'), { recursive: true })
  compliance.verifyCompliance(root)
  fs.writeFileSync(path.join(appDir, 'third-party-compliance', 'README.md'), 'changed')
  assert.throws(() => compliance.verifyCompliance(root), /Compliance (size|hash) mismatch/)
})

test('all final platform ASAR gates require byte-identical capsule manifests and preferred-source archives', async t => {
  const { root, appDir, files } = fixture(t)
  compliance.stageCompliance(root)
  for (const platform of ['linux', 'darwin', 'win32']) {
    const out = path.join(root, 'out', platform)
    const resources = platform === 'darwin'
      ? path.join(out, 'Fixture.app', 'Contents', 'Resources')
      : path.join(out, 'resources')
    fs.mkdirSync(resources, { recursive: true })
    const archive = path.join(resources, 'app.asar')
    await asar.createPackage(appDir, archive)
    compliance.verifyPackagedCompliance(archive, appDir)
    const context = {
      electronPlatformName: platform,
      appOutDir: out,
      packager: { info: { appDir }, appInfo: { productFilename: 'Fixture' } }
    }
    if (platform !== 'win32') await afterPack(context)
    const source = path.join(appDir, 'third-party-compliance', 'sources', 'preferred-source.tar.gz')
    const original = files['sources/preferred-source.tar.gz']
    fs.writeFileSync(source, Buffer.alloc(original.length))
    await asar.createPackage(appDir, archive)
    fs.writeFileSync(source, original)
    await assert.rejects(afterPack(context), /Compliance hash mismatch/)
    fs.rmSync(source)
    await asar.createPackage(appDir, archive)
    fs.writeFileSync(source, original)
    await assert.rejects(afterPack(context), /not found/)
  }
})
