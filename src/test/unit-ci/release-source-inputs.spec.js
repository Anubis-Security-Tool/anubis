const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const zlib = require('node:zlib')
const crypto = require('node:crypto')
const { pins, stageSdk } = require('../../build/bin/release-source-inputs')
const { patchTarget, HELPER_SHA256 } = require('../../build/bin/nsis/release-support')
const { verifyBlockmap } = require('../../build/bin/nsis/build-release')
const { assembleWebClient } = require('../../build/bin/assemble-web-client')
const root = path.resolve(__dirname, '../../..')
const digest = value => crypto.createHash('sha256').update(value).digest('hex')

test('release pins use immutable exact own source commits', () => {
  assert.equal(pins().schemaVersion, 1)
  for (const name of ['resource', 'web', 'sdk']) assert.match(pins()[name].commit, /^[a-f0-9]{40}$/)
})

test('locale navigation targets the real public package source and existing file layout', () => {
  const pack = require('../../../package.json')
  const brand = require('../../common/brand.config')
  assert.equal(pack.languageRepo, 'https://github.com/Anubis-Security-Tool/anubis-packages/tree/main/locales')
  assert.equal(brand.repo.localesEdit, 'https://github.com/Anubis-Security-Tool/anubis-packages/edit/main/locales/dist/cjs')
})

test('private NSIS patch removes every generated writer execution fallback and binds exact original', () => {
  const original = path.join(path.dirname(require.resolve('app-builder-lib/package.json')), 'out/targets/nsis/NsisTarget.js')
  const code = fs.readFileSync(original, 'utf8')
  const patched = patchTarget(code, 'reviewed-bridge.js')
  assert(patched.includes('reconstructWriter(installerPath, uninstallerPath, defines)'))
  assert(!patched.includes('wineVm.exec(installerPath'))
  assert(!patched.includes('vm.exec(installerPath'))
  assert(!patched.includes('UninstallerReader.exec(installerPath'))
  assert.throws(() => patchTarget(code + '\n', 'reviewed-bridge.js'), /Unreviewed/)
  assert.equal(digest(fs.readFileSync(path.join(root, 'src/build/bin/nsis/data-only-uninstaller.cjs'))), HELPER_SHA256)
})

test('blockmap verification requires every exact byte, checksum and positive chunk length', () => {
  const privateRoot = path.dirname(require.resolve('app-builder-lib/package.json'))
  const { blake2b } = require(path.join(privateRoot, 'node_modules/@noble/hashes/blake2.js'))
  const bytes = Buffer.from('exact installer bytes')
  const sizes = [4, bytes.length - 4]
  const checksums = [bytes.subarray(0, 4), bytes.subarray(4)].map(chunk => Buffer.from(blake2b(chunk, { dkLen: 18 })).toString('base64'))
  const map = { version: '2', files: [{ name: 'file', offset: 0, sizes, checksums }] }
  const encoded = value => zlib.gzipSync(JSON.stringify(value))
  assert.equal(verifyBlockmap(bytes, encoded(map), blake2b), 2)
  assert.throws(() => verifyBlockmap(Buffer.concat([bytes, Buffer.from('x')]), encoded(map), blake2b))
  assert.throws(() => verifyBlockmap(Buffer.from('wrong installer bytes'), encoded(map), blake2b))
  assert.throws(() => verifyBlockmap(bytes, encoded({ ...map, files: [{ name: 'file', offset: 0, sizes: [0, bytes.length], checksums }] }), blake2b))
  assert.throws(() => verifyBlockmap(bytes, encoded({ ...map, files: [{ name: 'file', offset: 1, sizes, checksums }] }), blake2b))
  assert.throws(() => verifyBlockmap(bytes, encoded({ ...map, files: [{ name: 'wrong', offset: 0, sizes, checksums }] }), blake2b))
})

test('source SDK staging requires exact runtime version and rejects traversal before replacing files', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'anubis-source-sdk-'))
  try {
    const source = path.join(temporary, 'source')
    const destination = path.join(temporary, 'app/node_modules/@ai-security-tool/managed-access')
    fs.mkdirSync(source, { recursive: true })
    fs.mkdirSync(destination, { recursive: true })
    fs.writeFileSync(path.join(temporary, 'app/package.json'), JSON.stringify({ dependencies: { '@ai-security-tool/managed-access': '1.0.4', ws: '8.18.3' } }))
    const metadata = { name: '@ai-security-tool/managed-access', version: '1.0.4', dependencies: { ws: '8.18.3' }, files: ['index.js'] }
    for (const file of ['index.js', 'LICENSE']) fs.writeFileSync(path.join(source, file), 'source bytes')
    const write = value => fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify(value))
    write(metadata)
    stageSdk(destination, source)
    assert.equal(fs.readFileSync(path.join(destination, 'index.js'), 'utf8'), 'source bytes')
    write({ ...metadata, files: ['../outside'] })
    assert.throws(() => stageSdk(destination, source))
    assert.equal(fs.readFileSync(path.join(destination, 'index.js'), 'utf8'), 'source bytes')
    write({ ...metadata, version: '1.0.3' })
    assert.throws(() => stageSdk(destination, source))
  } finally { fs.rmSync(temporary, { recursive: true, force: true }) }
})

test('renderer publication binds the actual assembled file tree to the reviewed source commit', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'anubis-renderer-source-'))
  try {
    const commit = 'a'.repeat(40)
    assembleWebClient({ root, target: temporary, registry: 'https://npm.anubis.locker/', sourceCommit: commit })
    const pkg = JSON.parse(fs.readFileSync(path.join(temporary, 'package.json')))
    assert.equal(pkg.anubisSource.commit, commit)
    assert.equal(pkg.anubisSource.repository, 'Anubis-Security-Tool/anubis')
    const rows = []
    const walk = relative => {
      const file = path.join(temporary, relative)
      if (fs.statSync(file).isDirectory()) for (const child of fs.readdirSync(file).sort()) walk(path.join(relative, child))
      else rows.push({ path: relative.split(path.sep).join('/'), sha256: digest(fs.readFileSync(file)) })
    }
    for (const file of pkg.files.filter(file => file === 'client' || file.startsWith('app/common/')).sort()) walk(file)
    assert.equal(pkg.anubisSource.filesSha256, digest(JSON.stringify(rows)))
  } finally { fs.rmSync(temporary, { recursive: true, force: true }) }
})
