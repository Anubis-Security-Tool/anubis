const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const zlib = require('node:zlib')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const S = require('./release-support')
const { inspect } = require('./inspect-pe-resources.cjs')

function streamMember (tool, archive, file) {
  return new Promise((resolve, reject) => {
    const child = spawn(tool, ['x', '-so', '-spd', '-bd', '-bso0', '-bse2', archive, file], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const hash = crypto.createHash('sha256')
    let bytes = 0
    let error = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error('7za stream timeout')) }, 120000)
    child.stdout.on('data', value => { bytes += value.length; hash.update(value) })
    child.stderr.on('data', value => { if (error.length < 65536) error += value })
    child.once('error', value => { clearTimeout(timer); reject(value) })
    child.once('close', code => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error(`7za exited ${code}: ${error}`))
      else resolve({ bytes, sha256: hash.digest('hex') })
    })
  })
}

function verifyBlockmap (installer, encoded, blake2b) {
  const map = JSON.parse(zlib.gunzipSync(encoded, { maxOutputLength: 4 * 1048576 }))
  assert.equal(map.version, '2')
  assert.equal(map.files.length, 1)
  const file = map.files[0]
  assert.equal(file.offset, 0)
  assert(file.sizes.length > 0 && file.sizes.length === file.checksums.length)
  let offset = 0
  for (let i = 0; i < file.sizes.length; i++) {
    const size = file.sizes[i]
    assert(Number.isSafeInteger(size) && size > 0 && offset + size <= installer.length)
    const checksum = Buffer.from(blake2b(installer.subarray(offset, offset + size), { dkLen: 18 })).toString('base64')
    assert.equal(checksum, file.checksums[i], `blockmap chunk ${i}`)
    offset += size
  }
  assert.equal(offset, installer.length)
  return file.sizes.length
}

function verifyCrc (bytes) {
  assert.equal(zlib.crc32(bytes.subarray(512, -4)), bytes.readUInt32LE(bytes.length - 4))
}

function verifyEmbedded (bytes, archive, uninstaller) {
  const pe = bytes.readUInt32LE(60)
  const sectionCount = bytes.readUInt16LE(pe + 6)
  const table = pe + 24 + bytes.readUInt16LE(pe + 20)
  let prefix = bytes.readUInt32LE(pe + 24 + 60)
  for (let i = 0; i < sectionCount; i++) {
    const section = table + i * 40
    prefix = Math.max(prefix, bytes.readUInt32LE(section + 20) + bytes.readUInt32LE(section + 16))
  }
  assert(prefix + 28 <= bytes.length)
  assert.equal(bytes.subarray(prefix + 4, prefix + 20).toString('hex'), 'efbeadde4e756c6c736f6674496e7374')
  assert.equal(bytes.readUInt32LE(prefix) & ~10, 0)
  assert.equal(bytes.readUInt32LE(prefix + 24), bytes.length - prefix)
  let archives = 0
  let uninstallers = 0
  let frames = 0
  for (let cursor = prefix + 28; cursor < bytes.length - 4;) {
    assert(++frames <= 1024 && cursor + 4 <= bytes.length - 4)
    const word = bytes.readUInt32LE(cursor)
    const size = word & 0x7fffffff
    const compressed = Boolean(word & 0x80000000)
    assert(cursor + 4 + size <= bytes.length - 4)
    const packed = bytes.subarray(cursor + 4, cursor + 4 + size)
    let data = packed
    if (compressed) {
      assert(size <= 8 * 1048576)
      const inflated = zlib.inflateRawSync(packed, { info: true, maxOutputLength: 8 * 1048576 })
      assert.equal(inflated.engine.bytesWritten, size)
      data = inflated.buffer
    }
    if (data.length === archive.bytes && crypto.createHash('sha256').update(data).digest('hex') === archive.sha256) {
      assert(!compressed)
      archives++
    }
    if (data.equals(uninstaller)) uninstallers++
    cursor += 4 + size
  }
  assert.equal(archives, 1)
  assert.equal(uninstallers, 1)
}

function verifySourceAsar (root, runtime) {
  const asar = require('@electron/asar')
  const archive = path.join(runtime, 'resources/app.asar')
  const get = relative => asar.extractFile(archive, relative)
  const pack = JSON.parse(get('package.json'))
  const sourcePack = JSON.parse(fs.readFileSync(path.join(root, 'package.json')))
  assert.equal(pack.name, 'anubis')
  assert.equal(pack.version, sourcePack.version)
  assert(!pack.qaEdition)
  for (const [directory, prefix] of [
    [path.join(root, 'src/app'), ''],
    [path.join(root, 'work/app/assets'), 'assets'],
    [path.join(root, 'work/app/browser-assets'), 'browser-assets']
  ]) {
    for (const row of S.inventory(directory)) {
      const relative = path.relative(directory, row.path)
      const expected = prefix === '' && relative === path.join('lib', 'install-src.js')
        ? fs.readFileSync(path.join(root, 'work/app', relative))
        : fs.readFileSync(row.path)
      assert(get(path.join(prefix, relative)).equals(expected), relative)
    }
  }
  assert(get('common/brand.config.js').equals(fs.readFileSync(path.join(root, 'src/common/brand.config.js'))))
  const sdk = path.join(root, '.release-inputs/sdk')
  const sdkPack = JSON.parse(fs.readFileSync(path.join(sdk, 'package.json')))
  assert.equal(pack.dependencies[sdkPack.name], sdkPack.version)
  for (const file of sdkPack.files) assert(get(path.join('node_modules', sdkPack.name, file)).equals(fs.readFileSync(path.join(sdk, file))))
}

async function main () {
  assert(process.platform === 'win32' && process.arch === 'x64', 'Native Windows x64 release runner required')
  assert(!process.env.CSC_LINK, 'Signed NSIS needs a separately reviewed signed-overlay verification path')
  const root = path.resolve(__dirname, '../../../..')
  require('../release-source-inputs').verify()
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json')))
  const version = metadata.version
  const output = path.join(root, 'dist')
  const installer = path.join(output, `anubis-${version}-win-x64-installer.exe`)
  assert(!fs.existsSync(installer), 'Refusing to overwrite an existing installer')
  const evidence = path.join(root, '.release-build/nsis-evidence')
  const privateRoot = S.privateBuilder(root)
  const { build, Platform, Arch } = require(privateRoot)
  const config = JSON.parse(fs.readFileSync(path.join(root, 'electron-builder.json')))
  const resource = process.env.BRAND_RES_DIR
  const icon = path.resolve(resource, 'res/icons/win/icon.ico')
  const compiler = (await require(path.join(privateRoot, 'out/toolsets/windows')).getMakeNsisPath()).path
  const runtime = path.join(output, 'win-unpacked')
  const archivePath = path.join(output, `anubis-${version}-x64.nsis.7z`)
  const context = { root, compiler, icon, evidence, installer, archiveBytes: 0 }
  S.configure(context)
  assert.equal(config.appId, 'locker.anubis.securitytool')
  assert.equal(config.nsis.perMachine, true)
  assert.equal(config.nsis.deleteAppDataOnUninstall, false)
  assert.equal(config.nsis.runAfterFinish, false)
  assert.equal(config.win.requestedExecutionLevel, 'asInvoker')
  config.win.target = ['nsis']
  config.win.signExecutable = false
  config.publish = null
  config.win.publish = null
  const tool = await require(path.join(privateRoot, 'out/toolsets/7zip')).getPath7za()
  assert.equal(S.fileHash(tool), '223b873c50380fe9a39f1a22b6abf8d46db506e1c08d08312902f6f3cd1f7ac3')
  let archive
  let runtimeRows
  let gateCalls = 0
  const checkMembers = async container => {
    for (const row of runtimeRows) {
      const result = await streamMember(tool, container, path.relative(runtime, row.path))
      assert.equal(result.bytes, row.bytes, row.path)
      assert.equal(result.sha256, row.sha256, row.path)
    }
  }
  S.capacity(root, 2 * 1024 * 1048576)
  await build({
    projectDir: root,
    config,
    targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64),
    publish: 'never',
    effectiveOptionComputed: async options => {
      assert.equal(++gateCalls, 1)
      assert(Array.isArray(options) && options.length === 2)
      const [defines, commands] = options
      assert.equal(defines.APP_64, archivePath)
      assert.equal(defines.APP_ID, config.appId)
      assert.equal(defines.APP_GUID.toLowerCase(), '745095cd-43ab-5c64-ac68-8eb0da974d57')
      assert.equal(defines.VERSION, version)
      assert.equal(commands.OutFile, `"${installer}"`)
      assert.equal(commands.SetCompressor, 'zlib')
      context.archiveBytes = fs.statSync(archivePath).size
      assert(context.archiveBytes <= 456 * 1048576)
      S.capacity(root, 2 * context.archiveBytes + 64 * 1048576)
      archive = { bytes: context.archiveBytes, sha256: S.fileHash(archivePath) }
      assert.equal(defines.APP_64_HASH, S.fileHash(archivePath, 'sha512').toUpperCase())
      runtimeRows = S.inventory(runtime)
      assert(runtimeRows.length >= 100 && runtimeRows.length <= 160)
      assert(!runtimeRows.some(row => path.basename(row.path) === 'anubis-machine-install.json'))
      verifySourceAsar(root, runtime)
      await checkMembers(archivePath)
      fs.writeFileSync(path.join(evidence, 'archive-gate.json'), JSON.stringify({ archive, defines, commands, runtimeRows }, null, 2), { flag: 'wx' })
      return false
    }
  })
  assert.equal(gateCalls, 1)
  assert.deepEqual(S.inventory(runtime), runtimeRows)
  const bytes = fs.readFileSync(installer)
  verifyCrc(bytes)
  const ico = fs.readFileSync(icon)
  const installerPe = inspect(bytes, ico, 'requireAdministrator', `${version}.0`)
  assert.equal(installerPe.machine, 332)
  const uninstaller = fs.readFileSync(path.join(evidence, 'uninstaller.exe'))
  verifyCrc(uninstaller)
  const uninstallerPe = inspect(uninstaller, ico, 'requireAdministrator', `${version}.0`)
  assert.equal(uninstallerPe.machine, 332)
  const appPe = inspect(fs.readFileSync(path.join(runtime, 'anubis.exe')), ico, 'asInvoker', `${version}.0`)
  assert.equal(appPe.machine, 34404)
  verifyEmbedded(bytes, archive, uninstaller)
  await checkMembers(installer)
  const { blake2b } = require(path.join(privateRoot, 'node_modules/@noble/hashes/blake2.js'))
  const blockmapChunks = verifyBlockmap(bytes, fs.readFileSync(installer + '.blockmap'), blake2b)
  require('../release-source-inputs').verify()
  const receipt = {
    completed: true,
    version,
    installer,
    bytes: bytes.length,
    sha256: S.fileHash(installer),
    blockmapSha256: S.fileHash(installer + '.blockmap'),
    blockmapChunks,
    installerPe,
    uninstallerPe,
    appPe,
    embeddedRuntimeFilesStreamVerified: runtimeRows.length,
    archive,
    generatedExecutableExecution: false,
    fallback: false,
    publication: false,
    freeAfterBytes: S.capacity(root)
  }
  fs.writeFileSync(path.join(evidence, 'final-nsis.json'), JSON.stringify(receipt, null, 2), { flag: 'wx' })
  console.log(JSON.stringify(receipt, null, 2))
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { verifyBlockmap, streamMember, verifyCrc, verifyEmbedded, main }
