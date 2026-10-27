const fs = require('fs')
const path = require('path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')

const hash = bytes => createHash('sha256').update(bytes).digest('hex')

function tree (files) {
  const sorted = Object.fromEntries(Object.keys(files).sort().map(file => [file, files[file]]))
  return {
    treeSha256: hash(Object.entries(sorted).map(([file, digest]) => `${digest}  ${file}\n`).join('')),
    count: Object.keys(sorted).length,
    files: sorted
  }
}

function inventory (directory, skipMarker = false) {
  const entries = []
  function visit (relative) {
    const file = path.join(directory, relative)
    const stat = fs.lstatSync(file)
    assert(!stat.isSymbolicLink(), `Linked browser asset: ${relative}`)
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(file).sort()) visit(path.join(relative, name))
    } else {
      assert(stat.isFile(), `Non-file browser asset: ${relative}`)
      const name = relative.split(path.sep).join('/')
      if (!skipMarker || name !== 'manifest.json') entries.push([name, hash(fs.readFileSync(file))])
    }
  }
  visit('')
  return tree(Object.fromEntries(entries))
}

function verifyStagedBrowserAssets (directory) {
  const bytes = fs.readFileSync(path.join(directory, 'manifest.json'))
  const manifest = JSON.parse(bytes)
  assert.deepEqual(inventory(directory, true), manifest.assets, 'Staged browser asset tree changed')
  return { bytes, manifest }
}

function verifyPackagedBrowserAssets (archive, appDir) {
  const asar = require('@electron/asar')
  asar.uncache(archive)
  const { bytes, manifest } = verifyStagedBrowserAssets(path.join(appDir, 'browser-assets'))
  assert(bytes.equals(asar.extractFile(archive, path.join('browser-assets', 'manifest.json'))), 'Packaged browser manifest changed')
  const entries = []
  for (const member of asar.listPackage(archive)) {
    const relative = member.slice(1)
    const normalized = relative.split(path.sep).join('/')
    if (!normalized.startsWith('browser-assets/') || normalized === 'browser-assets/manifest.json') continue
    const info = asar.statFile(archive, relative, false)
    assert(!info.link, `Linked packaged browser asset: ${normalized}`)
    if (!info.files) entries.push([normalized.slice('browser-assets/'.length), hash(asar.extractFile(archive, relative))])
  }
  assert.deepEqual(tree(Object.fromEntries(entries)), manifest.assets, 'Packaged browser asset tree changed')
}

function stageBrowserAssets ({
  destination,
  source = path.join(path.dirname(require.resolve('@ai-security-tool/anubis-browser-assets/package.json')), 'assets'),
  version = require('@ai-security-tool/anubis-browser-assets/package.json').version
}) {
  for (const entry of [
    `js/basic-${version}.js`,
    `js/electerm-${version}.js`,
    `js/worker-${version}.js`,
    `css/style-${version}.css`
  ]) {
    const file = path.join(source, entry)
    if (!fs.statSync(file).isFile() || fs.statSync(file).size === 0) {
      throw new Error(`Missing managed browser asset: ${entry}`)
    }
  }
  if (path.resolve(source) === path.resolve(destination)) {
    throw new Error('Managed browser staging must not overwrite its source')
  }
  assert(!fs.existsSync(path.join(source, 'manifest.json')), 'Publisher assets must not contain the native manifest marker')
  const assets = inventory(source)
  const proof = path.join(path.dirname(source), 'source.json')
  if (fs.existsSync(proof)) {
    const published = JSON.parse(fs.readFileSync(proof)).assets
    assert.equal(assets.count, published.count, 'Publisher browser asset count mismatch')
    assert.equal(assets.treeSha256, published.treeSha256, 'Publisher browser asset tree mismatch')
    assert.deepEqual(assets.files, published.files, 'Publisher browser asset files mismatch')
  }
  fs.rmSync(destination, { recursive: true, force: true })
  fs.cpSync(source, destination, { recursive: true })
  fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify({ version, assets }))
  verifyStagedBrowserAssets(destination)
  return destination
}

module.exports = { stageBrowserAssets, verifyStagedBrowserAssets, verifyPackagedBrowserAssets }
