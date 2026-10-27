const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')

const noticeName = /^(?:licen[cs]es?|unlicense|copying|notices?|copyright|authors|contributors|ofl|patents|third[-_ ]?party(?:[-_ ]?(?:licen[cs]es?|notices?))?)(?:[._ -].*)?$/i
const readmeName = /^readme(?:[._ -].*)?$/i
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const destination = root => path.join(root, 'work', 'app', 'third-party-notices')
const manifestName = 'manifest.json'

function verify (manifest, read) {
  assert.equal(manifest.schemaVersion, 1, 'Unsupported notices manifest')
  assert(Array.isArray(manifest.files) && manifest.files.length > 0, 'Missing legal notices')
  const checked = new Set()
  for (const row of manifest.files) {
    assert(typeof row.origin === 'string' && row.origin.length > 0)
    assert.match(row.sha256, /^[a-f0-9]{64}$/)
    assert.equal(row.relative, `texts/${row.sha256}.txt`)
    assert(Number.isSafeInteger(row.bytes) && row.bytes >= 0)
    if (checked.has(row.relative)) continue
    const bytes = read(row.relative)
    assert.equal(bytes.length, row.bytes, `Notice size mismatch: ${row.origin}`)
    assert.equal(digest(bytes), row.sha256, `Notice hash mismatch: ${row.origin}`)
    checked.add(row.relative)
  }
}

function verifyNotices (root) {
  const dir = destination(root)
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, manifestName)))
  verify(manifest, relative => fs.readFileSync(path.join(dir, relative)))
}

function capture (root, build) {
  const dir = destination(root)
  if (build) fs.rmSync(dir, { recursive: true, force: true })
  else verifyNotices(root)
  fs.mkdirSync(path.join(dir, 'texts'), { recursive: true })
  const previous = build ? [] : JSON.parse(fs.readFileSync(path.join(dir, manifestName))).files
  const fallbacks = build ? [] : JSON.parse(fs.readFileSync(path.join(dir, manifestName))).readmeFallbacks
  const rows = new Map(previous.map(row => [row.origin, row]))

  function retain (file, origin) {
    const bytes = fs.readFileSync(file)
    const sha256 = digest(bytes)
    const relative = `texts/${sha256}.txt`
    // Flat content-addressed names also avoid electron-builder's test/README exclusions.
    fs.writeFileSync(path.join(dir, relative), bytes)
    rows.set(origin, { origin, relative, bytes: bytes.length, sha256 })
  }

  function entries (directory) {
    return fs.readdirSync(directory).sort().map(name => {
      const file = path.join(directory, name)
      const stat = fs.lstatSync(file)
      assert(!stat.isSymbolicLink(), `Linked notice source is unsupported: ${file}`)
      return { name, file, directory: stat.isDirectory(), regular: stat.isFile() }
    })
  }

  function modules (directory, origin) {
    for (const entry of entries(directory).filter(entry => !entry.name.startsWith('.'))) {
      if (!entry.directory) continue
      if (entry.name.startsWith('@')) modules(entry.file, `${origin}/${entry.name}`)
      else dependency(entry.file, `${origin}/${entry.name}`)
    }
  }

  function dependency (directory, origin) {
    const metadata = path.join(directory, 'package.json')
    if (fs.existsSync(metadata)) retain(metadata, `${origin}/package.json`)
    let hasNotice = false
    const fallback = []
    function walk (current, prefix, legalDirectory = false) {
      for (const entry of entries(current)) {
        const name = `${prefix}/${entry.name}`
        if (entry.name === 'node_modules' && entry.directory) modules(entry.file, name)
        else if (entry.directory && entry.name !== '.git') {
          walk(entry.file, name, legalDirectory || /^(?:licen[cs]es?|notices?)$/i.test(entry.name))
        } else if (entry.regular && (legalDirectory || noticeName.test(entry.name))) {
          retain(entry.file, name)
          hasNotice = true
        } else if (entry.regular && readmeName.test(entry.name)) fallback.push([entry.file, name])
      }
    }
    walk(directory, origin)
    if (!hasNotice) {
      fallbacks.push({ origin, readmes: fallback.map(args => args[1]) })
      for (const args of fallback) retain(...args)
    } else {
      for (const args of fallback.filter(args => path.dirname(args[0]) === directory)) retain(...args)
    }
  }

  if (build) {
    for (const name of fs.readdirSync(root).sort().filter(name => noticeName.test(name) || name === 'package.json')) {
      const file = path.join(root, name)
      const stat = fs.lstatSync(file)
      assert(stat.isFile() && !stat.isSymbolicLink(), `Invalid project legal file: ${file}`)
      retain(file, `project/${name}`)
    }
    function bundles (directory, origin) {
      for (const entry of entries(directory)) {
        const name = `${origin}/${entry.name}`
        if (entry.directory) bundles(entry.file, name)
        else if (entry.regular && /(?:^|\.)licen[cs]e(?:\..*)?$/i.test(entry.name)) retain(entry.file, name)
      }
    }
    bundles(path.join(root, 'work', 'app', 'assets'), 'bundles')
    modules(path.join(root, 'node_modules'), 'build/node_modules')
  } else {
    modules(path.join(root, 'work', 'app', 'node_modules'), 'runtime/node_modules')
  }
  const files = Array.from(rows.values()).sort((a, b) => a.origin < b.origin ? -1 : a.origin > b.origin ? 1 : 0)
  const readmeFallbacks = fallbacks.sort((a, b) => a.origin < b.origin ? -1 : a.origin > b.origin ? 1 : 0)
  fs.writeFileSync(path.join(dir, manifestName), JSON.stringify({ schemaVersion: 1, files, readmeFallbacks }, null, 2) + '\n')
  verifyNotices(root)
}

function verifyPackagedNotices (archive, appDir) {
  const asar = require('@electron/asar')
  asar.uncache(archive)
  const original = fs.readFileSync(path.join(appDir, 'third-party-notices', manifestName))
  const packaged = asar.extractFile(archive, path.join('third-party-notices', manifestName))
  assert(original.equals(packaged), 'Packaged notices manifest changed')
  verify(JSON.parse(packaged), relative => asar.extractFile(archive, path.join('third-party-notices', relative)))
}

module.exports = {
  captureBuildNotices: root => capture(root, true),
  captureRuntimeNotices: root => capture(root, false),
  verifyNotices,
  verifyPackagedNotices
}
