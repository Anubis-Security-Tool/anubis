const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const zlib = require('node:zlib')
const crypto = require('node:crypto')
const { pins, stageSdk, nativeViteConfig, prepareReleaseApp } = require('../../build/bin/release-source-inputs')
const { patchTarget, HELPER_SHA256 } = require('../../build/bin/nsis/release-support')
const { verifyBlockmap, verifyRuntimeInventory, verifySourceAsar } = require('../../build/bin/nsis/build-release')
const { assembleWebClient } = require('../../build/bin/assemble-web-client')
const { pathToFileURL } = require('node:url')
const { spawnSync } = require('node:child_process')
const { finished } = require('node:stream/promises')
const root = path.resolve(__dirname, '../../..')
const digest = value => crypto.createHash('sha256').update(value).digest('hex')

test('release pins use immutable exact own source commits', () => {
  assert.equal(pins().schemaVersion, 1)
  for (const name of ['resource', 'web', 'sdk']) assert.match(pins()[name].commit, /^[a-f0-9]{40}$/)
})

test('fresh native Vite retains its config and emits actual module evidence with the exact pinned browser plugin', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'anubis-native-vite-proof-'))
  try {
    fs.mkdirSync(path.join(temporary, 'src/build/vite'), { recursive: true })
    fs.mkdirSync(path.join(temporary, '.release-build/browser/build/vite'), { recursive: true })
    fs.writeFileSync(path.join(temporary, 'package.json'), '{"type":"module"}')
    fs.writeFileSync(path.join(temporary, 'src/build/vite/conf.js'),
      "export default { plugins: [{ name: 'native-ui' }], root: 'unchanged', build: { outDir: 'assets' } }")
    fs.writeFileSync(path.join(temporary, '.release-build/browser/build/vite/browser-dependencies.js'),
      "export function browserDependencies () { return { name: 'actual-pinned-evidence' } }")
    const config = nativeViteConfig(temporary)
    const { default: actual } = await import(pathToFileURL(config).href)
    assert.deepEqual(actual.plugins.map(plugin => plugin.name), ['native-ui', 'actual-pinned-evidence'])
    assert.equal(actual.root, 'unchanged')
    assert.deepEqual(actual.build, { outDir: 'assets' })
    assert.throws(() => nativeViteConfig(temporary), { code: 'EEXIST' })
    const driver = fs.readFileSync(path.join(root, 'src/build/bin/release-source-inputs.js'), 'utf8')
    assert(driver.includes('additionalBundleManifests: [nativeBundleManifest]'))
    assert(driver.includes("path.join(root, 'work/app/assets/browser-dependencies.json')"))
  } finally { fs.rmSync(temporary, { recursive: true, force: true }) }
})

test('locale navigation targets the real public package source and existing file layout', () => {
  const pack = require('../../../package.json')
  const brand = require('../../common/brand.config')
  assert.equal(pack.languageRepo, 'https://github.com/Anubis-Security-Tool/anubis-packages/tree/main/locales')
  assert.equal(brand.repo.localesEdit, 'https://github.com/Anubis-Security-Tool/anubis-packages/edit/main/locales/dist/cjs')
})

test('release prepares the complete runtime with pinned browser and SDK sources before packaging', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'anubis-release-prepare-'))
  try {
    const script = path.join(temporary, 'src/build/bin/prepare.js')
    fs.mkdirSync(path.dirname(script), { recursive: true })
    fs.writeFileSync(script, `
      const fs = require('node:fs')
      fs.mkdirSync('work/app/lib', { recursive: true })
      for (const file of ['app.js', 'lib/create-app.js', 'package.json']) fs.writeFileSync('work/app/' + file, '{}')
      fs.writeFileSync('prepared.json', JSON.stringify({
        browser: process.env.ANUBIS_BROWSER_ASSETS_DIR,
        sdk: process.env.ANUBIS_SDK_SOURCE_DIR,
        cwd: process.cwd()
      }))
    `)
    const assets = path.join(temporary, 'fresh-browser')
    const sdk = path.join(temporary, 'pinned-sdk')
    prepareReleaseApp(temporary, assets, sdk)
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(temporary, 'prepared.json'))), {
      browser: assets, sdk, cwd: temporary
    })
    const driver = fs.readFileSync(path.join(root, 'src/build/bin/release-source-inputs.js'), 'utf8')
    assert(driver.includes("run(root, path.join(__dirname, 'clean.js'))"))
    assert(driver.indexOf("run(root, path.join(__dirname, 'clean.js'))") < driver.indexOf("run(path.join(root, 'src/build/vite')"))
    assert(driver.indexOf('prepareReleaseApp(root, assets,') < driver.indexOf("fs.writeFileSync(path.join(root, '.release-build/source-provenance.json')"))
    fs.unlinkSync(path.join(temporary, 'work/app/app.js'))
    fs.writeFileSync(script, '')
    assert.throws(() => prepareReleaseApp(temporary, assets, sdk), { code: 'ENOENT' })
    fs.writeFileSync(script, 'process.exit(37)')
    assert.throws(() => prepareReleaseApp(temporary, assets, sdk), error => error.status === 37)
  } finally { fs.rmSync(temporary, { recursive: true, force: true }) }
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

test('NSIS CLI failures remain nonzero despite the actual builder cleanup hook', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'anubis-nsis-exit-'))
  try {
    const preload = path.join(temporary, 'preload.cjs')
    fs.writeFileSync(preload, `
      const Module = require('node:module')
      require(${JSON.stringify(require.resolve('async-exit-hook'))})(callback => { if (callback) setImmediate(callback) })
      const original = Module._load
      Module._load = function (request, parent, ...args) {
        if (parent && parent.filename === process.argv[1]) {
          if (request === './build-common') return { writeSrc () {} }
          if (request === './nsis/build-release') return {
            main: async () => { if (process.env.ANUBIS_TEST_NSIS_FAIL === '1') throw new Error('NSIS failure fixture') }
          }
          if (request === '../release-source-inputs') return { verify () { throw new Error('NSIS failure fixture') } }
        }
        return original.call(this, request, parent, ...args)
      }
    `)
    for (const [file, failure] of [['build-win-nsis.js', false], ['build-win-nsis.js', true], ['nsis/build-release.js', true]]) {
      const result = spawnSync(process.execPath, ['--require', preload, path.join(root, 'src/build/bin', file)], {
        env: { ...process.env, CSC_LINK: '', ANUBIS_TEST_NSIS_FAIL: failure ? '1' : '0' },
        encoding: 'utf8',
        timeout: 10000
      })
      assert.ifError(result.error)
      assert.equal(result.signal, null)
      assert.equal(result.status, failure ? 1 : 0, `${file}: ${result.stderr}`)
      if (failure) assert.match(result.stderr, /NSIS failure fixture|Native Windows x64 release runner required/)
      else assert.equal(result.stderr, '')
    }
  } finally { fs.rmSync(temporary, { recursive: true, force: true }) }
})

test('NSIS inventories require the exact runtime and every actual unpacked member, not a file-count approximation', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'anubis-nsis-inventory-'))
  try {
    const runtime = path.join(temporary, 'runtime')
    const app = path.join(temporary, 'app')
    const write = (base, relative, bytes = 'runtime fixture') => {
      const file = path.join(base, relative)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, bytes)
    }
    for (const relative of [
      'anubis.exe', 'anubis-host.exe', 'chrome_100_percent.pak', 'chrome_200_percent.pak',
      'd3dcompiler_47.dll', 'dxcompiler.dll', 'dxil.dll', 'ffmpeg.dll', 'icudtl.dat',
      'LICENSE.electron.txt', 'LICENSES.chromium.html', 'locales/en-US.pak',
      'resources.pak', 'resources/elevate.exe', 'snapshot_blob.bin', 'v8_context_snapshot.bin',
      'vk_swiftshader_icd.json', 'vk_swiftshader.dll', 'vulkan-1.dll',
      'resources/app.asar.unpacked/node_modules/node-pty/build/Release/conpty/conpty.dll',
      'resources/app.asar.unpacked/node_modules/node-pty/build/Release/conpty/OpenConsole.exe'
    ]) write(runtime, relative)
    const required = [
      'node_modules/node-pty/build/Release/conpty.node',
      'node_modules/node-pty/build/Release/conpty_console_list.node',
      'node_modules/@serialport/bindings-cpp/build/Release/bindings.node'
    ]
    for (const relative of required) write(app, relative)
    for (let i = 0; i < 170; i++) write(app, `node_modules/node-pty/build/Release/obj/rebuilt-${i}.node`)
    const asar = require('@electron/asar')
    const archive = path.join(runtime, 'resources/app.asar')
    const pack = async () => finished(await asar.createPackageWithOptions(app, archive, { unpack: '**/*.node' }))
    await pack()
    const original = Buffer.from('Original Go license fixture\n')
    const sha256 = digest(original)
    const record = { source: 'go-toolchain', version: 'go1.27.3', original: 'LICENSE', relative: `${sha256}.txt`, bytes: original.length, sha256 }
    const notices = { schemaVersion: 1, files: [record, { ...record, source: 'golang.org/x/sys', version: 'v0.1.0' }] }
    const manifest = 'third-party-go-notices/manifest.json'
    const notice = `third-party-go-notices/${record.relative}`
    write(runtime, manifest, JSON.stringify(notices))
    write(runtime, notice, original)
    const inventory = () => require('../../build/bin/nsis/release-support').inventory(runtime)
    const verify = () => verifyRuntimeInventory(runtime, inventory())
    assert(inventory().length > 160)
    verify()
    for (const unexpected of [
      'resources/unindexed.dll',
      'resources/app.asar.unpacked/node_modules/node-pty/build/Release/unindexed.dll',
      'third-party-go-notices/unindexed.txt'
    ]) {
      write(runtime, unexpected)
      assert.throws(verify, /Windows runtime inventory/)
      fs.unlinkSync(path.join(runtime, unexpected))
    }
    write(runtime, 'anubis-machine-install.json', '{}')
    assert.throws(verify, /Windows runtime inventory/)
    fs.unlinkSync(path.join(runtime, 'anubis-machine-install.json'))
    fs.unlinkSync(path.join(runtime, 'resources/elevate.exe'))
    assert.throws(verify, /Windows runtime inventory/)
    write(runtime, 'resources/elevate.exe')
    const unpacked = `resources/app.asar.unpacked/${required[0]}`
    fs.unlinkSync(path.join(runtime, unpacked))
    assert.throws(verify, /Windows runtime inventory/)
    write(runtime, unpacked)
    write(runtime, notice, Buffer.alloc(original.length))
    assert.throws(verify, /Changed or missing original Go notice/)
    write(runtime, notice, original)
    write(runtime, manifest, JSON.stringify({ ...notices, files: [{ ...record, relative: '../escape' }] }))
    assert.throws(verify, /Unsafe original Go notice path/)
    write(runtime, manifest, JSON.stringify(notices))
    verify()
    fs.unlinkSync(path.join(app, required[1]))
    await pack()
    assert.throws(verify, /Missing unpacked Windows native module/)
  } finally { fs.rmSync(temporary, { recursive: true, force: true }) }
})

test('NSIS source verification uses the actual SDK producer metadata transform and exact source/license bytes', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'anubis-nsis-sdk-'))
  try {
    const app = path.join(temporary, 'work/app')
    const runtime = path.join(temporary, 'runtime')
    const sdk = path.join(temporary, '.release-inputs/sdk')
    const name = '@ai-security-tool/managed-access'
    const write = (base, relative, bytes) => {
      const file = path.join(base, relative)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, bytes)
    }
    write(temporary, 'package.json', JSON.stringify({ version: '5.7.6' }))
    write(app, 'package.json', JSON.stringify({ name: 'anubis', version: '5.7.6', dependencies: { [name]: '1.0.4', ws: '8.18.3' } }))
    for (const base of ['src/app', 'work/app']) write(temporary, `${base}/app.js`, 'unchanged desktop source')
    for (const relative of ['src/common/brand.config.js', 'work/app/common/brand.config.js']) write(temporary, relative, 'unchanged brand source')
    write(app, 'assets/entry.js', 'unchanged native renderer')
    write(app, 'browser-assets/entry.js', 'unchanged browser renderer')
    const metadata = {
      name,
      version: '1.0.4',
      main: 'index.js',
      license: 'MIT',
      files: ['index.js'],
      dependencies: { ws: '8.18.3' },
      engines: { node: '>=18' },
      bugs: { url: 'https://github.com/Anubis-Security-Tool/anubis-managed-access/issues' },
      homepage: 'https://anubis.locker',
      scripts: { test: 'node --test' },
      keywords: ['managed']
    }
    const originalMetadata = JSON.stringify(metadata, null, 2) + '\n'
    write(sdk, 'package.json', originalMetadata)
    write(sdk, 'index.js', 'unchanged SDK source')
    write(sdk, 'LICENSE', 'Complete original SDK license fixture\r\n')
    const staged = path.join(app, 'node_modules', name)
    stageSdk(staged, sdk)
    const { createTransformer } = require('app-builder-lib/out/fileTransformer')
    const produced = JSON.parse(await createTransformer(app, {})(path.join(staged, 'package.json')))
    assert.equal(produced.bugs, undefined)
    assert.equal(produced.scripts, undefined)
    assert.equal(produced.keywords, undefined)
    assert.equal(produced.homepage, metadata.homepage)
    assert.equal(produced.license, metadata.license)
    const archive = path.join(runtime, 'resources/app.asar')
    fs.mkdirSync(path.dirname(archive), { recursive: true })
    const asar = require('@electron/asar')
    const pack = async (value = produced) => {
      write(staged, 'package.json', JSON.stringify(value))
      try { await finished(await asar.createPackage(app, archive)) } finally { write(staged, 'package.json', originalMetadata) }
    }
    const verify = () => verifySourceAsar(temporary, runtime, {})
    await pack()
    await verify()
    for (const changed of [
      { ...produced, version: '1.0.3' },
      { ...produced, license: 'changed' },
      { ...produced, homepage: 'https://unrelated.invalid' },
      { ...produced, dependencies: { ws: '0.0.0' } },
      { ...produced, bugs: metadata.bugs }
    ]) {
      await pack(changed)
      await assert.rejects(verify)
    }
    await pack()
    write(staged, 'package.json', JSON.stringify({ ...metadata, homepage: 'changed' }))
    await assert.rejects(verify, /Staged SDK metadata differs/)
    write(staged, 'package.json', originalMetadata)
    for (const file of ['index.js', 'LICENSE']) {
      const original = fs.readFileSync(path.join(staged, file))
      write(staged, file, Buffer.alloc(original.length))
      await pack()
      write(staged, file, original)
      await assert.rejects(verify, /Pinned SDK source changed/)
    }
  } finally { fs.rmSync(temporary, { recursive: true, force: true }) }
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
