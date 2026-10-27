const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const helper = require('./data-only-uninstaller.cjs')

const HELPER_SHA256 = 'fad6a7be3de283e58e877cd3f31fbcf0f14fb9e25efb022af25da4d4ae670914'
const TARGET_SHA256 = '0673ad598188c5396ab29f70b104f5057b925ec494b2969018682ce664f1b7a7'
const ICON_SHA256 = '674e9b360dd8eb0a33489d1e86d86be5939173d7b4b46638a9d631208bef2b2b'
const FLOOR = 512 * 1048576
const hash = (bytes, algorithm = 'sha256') => crypto.createHash(algorithm).update(bytes).digest('hex')
const fileHash = (file, algorithm) => hash(fs.readFileSync(file), algorithm)
let context

function capacity (root, extra = 0) {
  const stat = fs.statfsSync(root)
  const free = stat.bavail * stat.bsize
  assert(free >= FLOOR + extra, `Capacity gate: ${free} < ${FLOOR + extra}`)
  return free
}

function regular (file) {
  const stat = fs.lstatSync(file)
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, file)
  assert.equal(fs.realpathSync.native(file).toLowerCase(), file.toLowerCase(), file)
  return stat
}

function inventory (directory) {
  assert(!fs.lstatSync(directory).isSymbolicLink(), directory)
  assert.equal(fs.realpathSync.native(directory).toLowerCase(), directory.toLowerCase(), directory)
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) return inventory(file)
    return [{ path: file, bytes: regular(file).size, sha256: fileHash(file) }]
  }).sort((a, b) => a.path.localeCompare(b.path))
}

function patchTarget (source, bridge) {
  assert.equal(hash(Buffer.from(source)), TARGET_SHA256, 'Unreviewed app-builder-lib NSIS target')
  const start = source.indexOf('        // http://forums.winamp.com/showthread.php?p=3078545')
  const end = source.indexOf('        await packager.signIf(uninstallerPath);', start)
  assert(start > 0 && end > start)
  return source.slice(0, start) +
    '        if (!isWin) throw new Error("Native Windows NSIS build required");\n' +
    `        await require(${JSON.stringify(bridge)}).reconstructWriter(installerPath, uninstallerPath, defines);\n` +
    source.slice(end)
}

function privateBuilder (root) {
  const original = path.dirname(require.resolve('app-builder-lib/package.json'))
  assert.equal(JSON.parse(fs.readFileSync(path.join(original, 'package.json'))).version, '26.15.7')
  assert.equal(fileHash(path.join(__dirname, 'data-only-uninstaller.cjs')), HELPER_SHA256)
  const destination = path.join(root, '.release-tools', 'app-builder-lib')
  assert(!fs.existsSync(destination), 'Private builder already exists; no automatic build retries')
  fs.cpSync(original, destination, { recursive: true, dereference: true, errorOnExist: true, force: false })
  const target = path.join(destination, 'out/targets/nsis/NsisTarget.js')
  fs.writeFileSync(target, patchTarget(fs.readFileSync(target, 'utf8'), __filename))
  const template = path.join(destination, 'templates/nsis/include/installUtil.nsh')
  const source = fs.readFileSync(template, 'utf8')
  const pattern = /(!macro setIsTryToKeepShortcuts\s+StrCpy \$isTryToKeepShortcuts "true"\s*)!ifdef allowToChangeInstallationDirectory[\s\S]*?!endif(\s*!macroend)/
  if (pattern.test(source)) fs.writeFileSync(template, source.replace(pattern, '$1$2'))
  else assert(/!macro setIsTryToKeepShortcuts\s+StrCpy \$isTryToKeepShortcuts "true"\s*!macroend/.test(source), 'Unreviewed keep-shortcuts template')
  return destination
}

function configure (value) {
  assert(!context)
  context = value
  assert.equal(fileHash(value.compiler), helper.COMPILER_SHA256)
  assert.equal(fileHash(value.icon), ICON_SHA256)
  fs.mkdirSync(value.evidence, { recursive: true })
}

async function reconstructWriter (input, output, defines) {
  assert(context, 'Missing reviewed NSIS context')
  assert.equal(input, context.installer)
  assert.equal(output, input.replace(/exe$/, '__uninstaller.exe'))
  assert.equal(path.dirname(output), path.join(context.root, 'dist'))
  assert(!fs.existsSync(output))
  assert.equal(defines.MUI_UNICON, context.icon)
  assert(regular(input).size <= 16 * 1048576)
  assert.equal(fileHash(context.compiler), helper.COMPILER_SHA256)
  const bytes = fs.readFileSync(input)
  const result = helper.reconstruct(bytes, {
    expectedInputSha256: hash(bytes),
    expectedIconSha256: ICON_SHA256,
    expectedCompilerSha256: helper.COMPILER_SHA256,
    icon: fs.readFileSync(context.icon)
  })
  const freeBefore = capacity(context.root, 2 * context.archiveBytes + 64 * 1048576)
  fs.writeFileSync(output, result.output, { flag: 'wx' })
  regular(output)
  assert.equal(fileHash(output), result.evidence.outputSha256)
  assert.equal(fileHash(input), result.evidence.inputSha256)
  fs.copyFileSync(output, path.join(context.evidence, 'uninstaller.exe'), fs.constants.COPYFILE_EXCL)
  fs.writeFileSync(path.join(context.evidence, 'data-only-uninstaller.json'), JSON.stringify({
    ...result.evidence,
    freeBefore,
    freeAfter: capacity(context.root),
    frozenHelperSha256: HELPER_SHA256,
    generatedWriterExecuted: false,
    fallback: false
  }, null, 2), { flag: 'wx' })
}

module.exports = { capacity, fileHash, inventory, privateBuilder, patchTarget, configure, reconstructWriter, ICON_SHA256, TARGET_SHA256, HELPER_SHA256 }
