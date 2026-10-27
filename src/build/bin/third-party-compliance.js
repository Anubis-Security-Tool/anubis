const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')

const name = '@ai-security-tool/third-party-compliance'
const folder = 'third-party-compliance'
const index = 'manifest.json'

function inventory (directory, prefix = '') {
  return fs.readdirSync(directory).sort().flatMap(name => {
    const file = path.join(directory, name)
    const relative = prefix ? `${prefix}/${name}` : name
    const stat = fs.lstatSync(file)
    assert(!stat.isSymbolicLink(), `Linked compliance source: ${file}`)
    if (stat.isDirectory()) return inventory(file, relative)
    assert(stat.isFile(), `Non-file compliance source: ${file}`)
    return [relative]
  })
}

function verify (manifest, read) {
  assert.equal(manifest.schemaVersion, 1, 'Unsupported compliance manifest')
  assert(Array.isArray(manifest.packages) && manifest.packages.length > 0)
  assert(Array.isArray(manifest.files) && manifest.files.length > 0)
  const paths = new Set([index])
  for (const row of manifest.files) {
    assert(typeof row.path === 'string' && row.path.length > 0)
    assert(!/[:\\\0]/.test(row.path) && !path.posix.isAbsolute(row.path), 'Unsafe compliance path')
    assert.equal(path.posix.normalize(row.path), row.path, 'Noncanonical compliance path')
    assert(!row.path.split('/').some(part => part === '..' || part === '.'), 'Unsafe compliance path')
    const key = row.path.toLowerCase()
    assert(!paths.has(key), `Duplicate compliance path: ${row.path}`)
    paths.add(key)
    assert.match(row.sha256, /^[a-f0-9]{64}$/)
    assert(Number.isSafeInteger(row.bytes) && row.bytes >= 0)
    const bytes = read(row.path)
    assert.equal(bytes.length, row.bytes, `Compliance size mismatch: ${row.path}`)
    assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sha256, `Compliance hash mismatch: ${row.path}`)
  }
}

function verifyDirectory (directory) {
  const files = inventory(directory)
  const bytes = fs.readFileSync(path.join(directory, index))
  const manifest = JSON.parse(bytes)
  verify(manifest, relative => fs.readFileSync(path.join(directory, relative)))
  assert.deepEqual(files.sort(), [index, ...manifest.files.map(row => row.path)].sort(), 'Unindexed compliance files')
  return { bytes, manifest }
}

function stageCompliance (root) {
  const source = path.join(root, 'node_modules', name)
  const { bytes, manifest } = verifyDirectory(source)
  const expected = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).devDependencies[name]
  const pkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json')))
  assert.equal(pkg.name, name)
  assert.equal(pkg.version, expected, 'Compliance dependency must have an exact version pin')
  assert(!pkg.main && !pkg.bin, 'Compliance capsule must not have an executable entry point')
  const destination = path.join(root, 'work', 'app', folder)
  fs.rmSync(destination, { recursive: true, force: true })
  for (const row of manifest.files) {
    const file = path.join(destination, row.path)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.copyFileSync(path.join(source, row.path), file)
  }
  fs.writeFileSync(path.join(destination, index), bytes)
  verifyDirectory(destination)
}

function verifyCompliance (root) {
  verifyDirectory(path.join(root, 'work', 'app', folder))
}

function verifyPackagedCompliance (archive, appDir) {
  const asar = require('@electron/asar')
  asar.uncache(archive)
  const { bytes, manifest } = verifyDirectory(path.join(appDir, folder))
  assert(bytes.equals(asar.extractFile(archive, path.join(folder, index))), 'Packaged compliance manifest changed')
  verify(manifest, relative => asar.extractFile(archive, path.join(folder, relative)))
}

module.exports = { stageCompliance, verifyCompliance, verifyPackagedCompliance }
