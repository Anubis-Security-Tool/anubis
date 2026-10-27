const fs = require('node:fs')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')

function range (bytes, start, size) {
  assert(Number.isSafeInteger(start) && Number.isSafeInteger(size) && start >= 0 && size >= 0 && start + size <= bytes.length, 'Out-of-range PE/ICO input')
  return bytes.subarray(start, start + size)
}

function peResources (bytes) {
  assert.equal(range(bytes, 0, 2).toString('ascii'), 'MZ', 'Missing DOS signature')
  const pe = range(bytes, 0x3c, 4).readUInt32LE()
  assert(range(bytes, pe, 4).equals(Buffer.from([0x50, 0x45, 0, 0])), 'Missing PE signature')
  const coff = range(bytes, pe + 4, 20)
  const sections = coff.readUInt16LE(2)
  const optionalSize = coff.readUInt16LE(16)
  assert(sections > 0 && sections <= 96, 'Invalid section count')
  const optional = range(bytes, pe + 24, optionalSize)
  const magic = range(optional, 0, 2).readUInt16LE()
  assert(magic === 0x10b || magic === 0x20b, 'Unsupported optional header')
  const directoryOffset = magic === 0x20b ? 112 : 96
  assert(range(optional, directoryOffset - 4, 4).readUInt32LE() >= 3, 'Missing resource directory slot')
  const resourceRva = range(optional, directoryOffset + 16, 4).readUInt32LE()
  const resourceSize = range(optional, directoryOffset + 20, 4).readUInt32LE()
  assert(resourceRva > 0 && resourceSize >= 16, 'Missing resource data')
  const table = []
  for (let i = 0; i < sections; i++) {
    const section = range(bytes, pe + 24 + optionalSize + 40 * i, 40)
    table.push({ rva: section.readUInt32LE(12), rawSize: section.readUInt32LE(16), raw: section.readUInt32LE(20) })
  }
  function fromRva (rva, size) {
    const matches = table.filter(section => rva >= section.rva && rva - section.rva + size <= section.rawSize)
    assert.equal(matches.length, 1, 'Unmapped or ambiguous resource RVA')
    return range(bytes, matches[0].raw + rva - matches[0].rva, size)
  }
  const directory = fromRva(resourceRva, resourceSize)
  const leaves = []
  function name (value) {
    if (!(value & 0x80000000)) return value
    const offset = value & 0x7fffffff
    const length = range(directory, offset, 2).readUInt16LE()
    return range(directory, offset + 2, length * 2).toString('utf16le')
  }
  function walk (offset, keys, ancestors) {
    assert(keys.length <= 3 && !ancestors.includes(offset), 'Cyclic/deep resource directory')
    const head = range(directory, offset, 16)
    const count = head.readUInt16LE(12) + head.readUInt16LE(14)
    assert(count <= 4096, 'Oversized resource directory')
    for (let i = 0; i < count; i++) {
      const entry = range(directory, offset + 16 + i * 8, 8)
      const currentKeys = [...keys, name(entry.readUInt32LE())]
      const target = entry.readUInt32LE(4)
      if (target & 0x80000000) {
        walk(target & 0x7fffffff, currentKeys, [...ancestors, offset])
      } else {
        assert.equal(currentKeys.length, 3, 'Unexpected resource leaf depth')
        const data = range(directory, target, 16)
        leaves.push({ keys: currentKeys, bytes: fromRva(data.readUInt32LE(), data.readUInt32LE(4)) })
        assert(leaves.length <= 4096, 'Too many resource leaves')
      }
    }
  }
  walk(0, [], [])
  return { machine: coff.readUInt16LE(), leaves }
}

function icoImages (bytes) {
  const head = range(bytes, 0, 6)
  assert.equal(head.readUInt16LE(), 0)
  assert.equal(head.readUInt16LE(2), 1)
  const count = head.readUInt16LE(4)
  assert(count > 0 && count <= 256, 'Invalid ICO image count')
  const images = []
  for (let i = 0; i < count; i++) {
    const entry = range(bytes, 6 + i * 16, 16)
    images.push(entry.subarray(0, 12).toString('hex') + ':' + sha(range(bytes, entry.readUInt32LE(12), entry.readUInt32LE(8))))
  }
  return images.sort()
}

function fixedVersion (bytes) {
  assert(range(bytes, 0, 6).readUInt16LE() <= bytes.length, 'Invalid VERSIONINFO length')
  let offset = 6
  while (range(bytes, offset, 2).readUInt16LE() !== 0) offset += 2
  assert.equal(range(bytes, 6, offset - 6).toString('utf16le'), 'VS_VERSION_INFO')
  offset = (offset + 2 + 3) & ~3
  const value = range(bytes, offset, 52)
  assert.equal(value.readUInt32LE(), 0xfeef04bd)
  const ms = value.readUInt32LE(8)
  const ls = value.readUInt32LE(12)
  return [ms >>> 16, ms & 65535, ls >>> 16, ls & 65535].join('.')
}

function inspect (bytes, icon, expectedLevel, expectedVersion) {
  const parsed = peResources(bytes)
  const manifests = parsed.leaves.filter(leaf => leaf.keys[0] === 24)
  const levels = manifests.map(leaf => {
    const text = leaf.bytes.toString(leaf.bytes[0] === 0xff && leaf.bytes[1] === 0xfe ? 'utf16le' : 'utf8')
    const match = text.match(/<requestedExecutionLevel\b[^>]*\blevel\s*=\s*["']([^"']+)["']/)
    assert(match, 'Missing execution-level declaration')
    return match[1]
  })
  if (expectedLevel) assert(levels.length > 0 && levels.every(level => level === expectedLevel), 'Unexpected execution level')
  const versions = parsed.leaves.filter(leaf => leaf.keys[0] === 16).map(leaf => fixedVersion(leaf.bytes))
  if (expectedVersion) assert(versions.length > 0 && versions.every(version => version === expectedVersion), 'Unexpected file version')
  const expectedIcons = icoImages(icon)
  const groups = parsed.leaves.filter(leaf => leaf.keys[0] === 14)
  assert(groups.length > 0, 'Missing icon groups')
  const iconGroups = groups.map(group => {
    const head = range(group.bytes, 0, 6)
    assert(head.readUInt16LE() === 0 && head.readUInt16LE(2) === 1, 'Invalid group icon')
    const count = head.readUInt16LE(4)
    assert(count > 0 && count <= 256, 'Invalid group count')
    const images = []
    for (let i = 0; i < count; i++) {
      const entry = range(group.bytes, 6 + i * 14, 14)
      const icons = parsed.leaves.filter(leaf => leaf.keys[0] === 3 && leaf.keys[1] === entry.readUInt16LE(12) && leaf.keys[2] === group.keys[2])
      assert.equal(icons.length, 1, 'Missing/ambiguous icon language resource')
      assert.equal(icons[0].bytes.length, entry.readUInt32LE(8), 'Icon size mismatch')
      images.push(entry.subarray(0, 12).toString('hex') + ':' + sha(icons[0].bytes))
    }
    return { name: group.keys[1], language: group.keys[2], matches: JSON.stringify(images.sort()) === JSON.stringify(expectedIcons) }
  })
  assert(iconGroups[0].matches, 'Primary PE icon differs from pinned ICO')
  return { sha256: sha(bytes), machine: parsed.machine, versions, executionLevels: levels, iconGroups, resourceLeaves: parsed.leaves.length }
}

module.exports = { peResources, icoImages, inspect }

if (require.main === module) {
  try {
    assert(process.argv.length >= 4 && process.argv.length <= 6, 'Usage: inspect-pe-resources.cjs PE ICO [LEVEL] [VERSION]')
    for (const file of process.argv.slice(2, 4)) {
      const stat = fs.lstatSync(file)
      assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 256 * 1024 * 1024, 'Refuse unsafe or oversized artifact')
    }
    console.log(JSON.stringify(inspect(fs.readFileSync(process.argv[2]), fs.readFileSync(process.argv[3]), process.argv[4], process.argv[5])))
  } catch (error) {
    console.error(JSON.stringify({ passed: false, error: error.message }))
    process.exitCode = 1
  }
}
