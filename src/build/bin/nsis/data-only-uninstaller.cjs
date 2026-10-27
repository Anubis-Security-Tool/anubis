'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const zlib = require('node:zlib')

const OWNER = path.resolve(__dirname, '..')
const MAX_INPUT = 16 * 1024 * 1024
const MAX_BLOCK = 8 * 1024 * 1024
const MAX_INFLATED = 32 * 1024 * 1024
const FLOOR = 536870912n
const SIGNATURE = Buffer.from('efbeadde4e756c6c736f6674496e7374', 'hex')
const COMPILER_SHA256 = 'e277b7378931b74392015f5ad6b1d744dcd8a347baa4480350a75ebeab8d8e3d'
const sha256 = buffer => crypto.createHash('sha256').update(buffer).digest('hex')

function requireThat (condition, message) {
  if (!condition) throw new Error(message)
}

function range (buffer, offset, size, label) {
  requireThat(Number.isSafeInteger(offset) && Number.isSafeInteger(size) &&
    offset >= 0 && size >= 0 && offset + size <= buffer.length, `${label}: range`)
  return buffer.subarray(offset, offset + size)
}

function u16 (buffer, offset) {
  return range(buffer, offset, 2, 'uint16').readUInt16LE()
}

function u32 (buffer, offset) {
  return range(buffer, offset, 4, 'uint32').readUInt32LE()
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0)
  return value >>> 0
})

function crc32 (buffer, previous = 0) {
  let value = (previous ^ 0xffffffff) >>> 0
  for (const byte of buffer) value = (value >>> 8) ^ CRC_TABLE[(value ^ byte) & 255]
  return (value ^ 0xffffffff) >>> 0
}

function checkDigest (buffer, expected, label) {
  requireThat(typeof expected === 'string' && /^[a-f0-9]{64}$/i.test(expected), `${label}: expected digest required`)
  requireThat(sha256(buffer) === expected.toLowerCase(), `${label}: digest mismatch`)
}

function peResources (buffer) {
  requireThat(range(buffer, 0, 2, 'DOS').toString('ascii') === 'MZ', 'PE: DOS signature')
  const pe = u32(buffer, 60)
  requireThat(pe >= 64 && pe <= 4096, 'PE: header offset')
  requireThat(range(buffer, pe, 4, 'PE signature').equals(Buffer.from([80, 69, 0, 0])), 'PE: signature')
  requireThat(u16(buffer, pe + 4) === 0x14c, 'PE: only NSIS x86 PE32 stub supported')
  const sectionCount = u16(buffer, pe + 6)
  const optionalBytes = u16(buffer, pe + 20)
  const optional = pe + 24
  requireThat(sectionCount > 0 && sectionCount <= 16 && optionalBytes === 224, 'PE: unsupported headers')
  range(buffer, optional, optionalBytes, 'optional header')
  requireThat(u16(buffer, optional) === 0x10b && u32(buffer, optional + 92) === 16, 'PE: optional header ABI')
  const alignment = u32(buffer, optional + 36)
  const headers = u32(buffer, optional + 60)
  requireThat(alignment === 512 && headers >= optional + optionalBytes + sectionCount * 40 &&
    headers % alignment === 0, 'PE: file alignment/headers')
  requireThat(u32(buffer, optional + 128) === 0 && u32(buffer, optional + 132) === 0, 'PE: signed overlay unsupported')
  const resourceRva = u32(buffer, optional + 112)
  const resourceBytes = u32(buffer, optional + 116)
  const sections = []
  let prefixBytes = headers
  for (let i = 0; i < sectionCount; i++) {
    const entry = optional + optionalBytes + i * 40
    range(buffer, entry, 40, 'section table')
    const name = range(buffer, entry, 8, 'section name').toString('ascii').replace(/\0.*$/, '')
    const rva = u32(buffer, entry + 12)
    const size = u32(buffer, entry + 16)
    const offset = u32(buffer, entry + 20)
    if (!size) {
      requireThat(offset === 0, 'PE: unsupported empty section')
      continue
    }
    requireThat(['.text', '.rdata', '.data', '.rsrc'].includes(name), `PE: unsupported section ${name}`)
    requireThat(offset >= headers && offset % alignment === 0 && size % alignment === 0, 'PE: raw section alignment')
    range(buffer, offset, size, 'raw section')
    for (const previous of sections) {
      requireThat(offset >= previous.offset + previous.size || previous.offset >= offset + size, 'PE: overlapping raw sections')
      requireThat(rva >= previous.rva + previous.size || previous.rva >= rva + size, 'PE: overlapping section RVAs')
    }
    sections.push({ name, rva, size, offset })
    prefixBytes = Math.max(prefixBytes, offset + size)
  }
  requireThat(prefixBytes >= 512 && prefixBytes <= 4 * 1024 * 1024, 'PE: prefix bound')
  const rsrc = sections.filter(section => section.name === '.rsrc')
  requireThat(rsrc.length === 1 && resourceBytes > 0 && resourceRva >= rsrc[0].rva &&
    resourceRva + resourceBytes <= rsrc[0].rva + rsrc[0].size, 'PE: resource directory')
  const root = rsrc[0].offset + resourceRva - rsrc[0].rva
  const resource = range(buffer, root, resourceBytes, 'resources')
  const leaves = []
  const visited = new Set()
  const keys = new Set()
  function directory (offset, ids) {
    requireThat(ids.length < 3 && !visited.has(offset), 'PE: resource depth/cycle/alias')
    visited.add(offset)
    range(resource, offset, 16, 'resource directory')
    requireThat(u16(resource, offset + 12) === 0, 'PE: named resources unsupported')
    const count = u16(resource, offset + 14)
    requireThat(count <= 256, 'PE: resource entry bound')
    range(resource, offset + 16, count * 8, 'resource entries')
    for (let i = 0; i < count; i++) {
      const entry = offset + 16 + i * 8
      const id = u32(resource, entry)
      const target = u32(resource, entry + 4)
      requireThat(id <= 65535, 'PE: resource numeric identifier')
      const next = [...ids, id]
      if (next.length < 3) {
        requireThat((target & 0x80000000) !== 0, 'PE: resource hierarchy')
        directory(target & 0x7fffffff, next)
      } else {
        requireThat((target & 0x80000000) === 0, 'PE: resource leaf')
        range(resource, target, 16, 'resource data entry')
        const dataRva = u32(resource, target)
        const bytes = u32(resource, target + 4)
        requireThat(u32(resource, target + 12) === 0 && dataRva >= resourceRva &&
          dataRva + bytes <= resourceRva + resourceBytes, 'PE: resource data range')
        const key = next.join('/')
        requireThat(!keys.has(key), 'PE: duplicate resource')
        keys.add(key)
        const dataOffset = rsrc[0].offset + dataRva - rsrc[0].rva
        leaves.push({ type: next[0], id: next[1], lang: next[2], offset: dataOffset, bytes })
      }
    }
  }
  directory(0, [])
  requireThat(leaves.length <= 1024, 'PE: resource leaf bound')
  return { prefixBytes, leaves }
}

function adminManifest (buffer, resources) {
  const manifests = resources.leaves.filter(leaf => leaf.type === 24)
  requireThat(manifests.length === 1 && manifests[0].id === 1, 'manifest: unique process manifest required')
  const bytes = range(buffer, manifests[0].offset, manifests[0].bytes, 'manifest')
  requireThat(bytes.length > 0 && bytes.length <= 65536 && !bytes.includes(0), 'manifest: bounded UTF-8 required')
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/<!--[\s\S]*?-->/g, '')
  requireThat(!/<!DOCTYPE|<!ENTITY/i.test(text), 'manifest: declarations unsupported')
  const tags = [...text.matchAll(/<requestedExecutionLevel\b([^<>]*)\/>/g)]
  requireThat(tags.length === 1, 'manifest: unique requestedExecutionLevel required')
  const attributes = [...tags[0][1].matchAll(/([A-Za-z]+)\s*=\s*(["'])([^"']*)\2/g)]
  requireThat(attributes.length === 2 && new Set(attributes.map(item => item[1])).size === 2 &&
    attributes.some(item => item[1] === 'level' && item[3] === 'requireAdministrator') &&
    attributes.some(item => item[1] === 'uiAccess' && item[3] === 'false') &&
    tags[0][1].replace(/([A-Za-z]+)\s*=\s*(["'])([^"']*)\2/g, '').trim() === '', 'manifest: admin level/uiAccess required')
  return { sha256: sha256(bytes), level: 'requireAdministrator', bytes: bytes.length }
}

function icoImages (ico) {
  requireThat(u16(ico, 0) === 0 && u16(ico, 2) === 1, 'ICO: header')
  const count = u16(ico, 4)
  requireThat(count > 0 && count <= 32, 'ICO: image count')
  const entriesEnd = 6 + count * 16
  range(ico, 0, entriesEnd, 'ICO directory')
  const images = []
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16
    const bytes = u32(ico, entry + 8)
    const offset = u32(ico, entry + 12)
    requireThat(bytes > 0 && offset >= entriesEnd && ico[entry + 3] === 0, 'ICO: image bounds')
    for (const previous of images) {
      requireThat(offset >= previous.offset + previous.bytes || previous.offset >= offset + bytes, 'ICO: overlapping images')
    }
    images.push({ offset, bytes, metadata: range(ico, entry, 8, 'ICO metadata').toString('hex'),
      sha256: sha256(range(ico, offset, bytes, 'ICO image')) })
  }
  return images
}

function firstHeader (buffer, uninstall) {
  range(buffer, 0, 28, 'NSIS firstheader')
  requireThat(range(buffer, 4, 16, 'NSIS signature').equals(SIGNATURE), 'NSIS: signature')
  const flags = u32(buffer, 0)
  requireThat((flags & ~15) === 0 && Boolean(flags & 1) === uninstall && (flags & 4) === 0, 'NSIS: unsupported flags/CRC disabled')
  const headerBytes = u32(buffer, 20)
  requireThat(headerBytes > 0 && headerBytes <= MAX_BLOCK && u32(buffer, 24) === buffer.length, 'NSIS: declared lengths/overlay')
  return { flags, headerBytes }
}

function frames (buffer, header, budget) {
  const result = []
  let cursor = 28
  const end = buffer.length - 4
  while (cursor < end) {
    requireThat(result.length < 1024 && cursor + 4 <= end, 'NSIS: block count/framing')
    const word = u32(buffer, cursor)
    const compressed = Boolean(word & 0x80000000)
    const storedBytes = word & 0x7fffffff
    requireThat(storedBytes <= MAX_BLOCK && cursor + 4 + storedBytes <= end, 'NSIS: block range')
    const stored = range(buffer, cursor + 4, storedBytes, 'NSIS block')
    let data = stored
    if (compressed) {
      requireThat(storedBytes > 0, 'NSIS: empty compressed block')
      const inflated = zlib.inflateRawSync(stored, { maxOutputLength: MAX_BLOCK, info: true })
      requireThat(inflated.engine.bytesWritten === storedBytes, 'NSIS: trailing compressed data')
      data = inflated.buffer
    }
    budget.bytes += data.length
    requireThat(data.length <= MAX_BLOCK && budget.bytes <= MAX_INFLATED, 'NSIS: inflated bound')
    result.push({ cursor, compressed, storedBytes, data })
    cursor += 4 + storedBytes
  }
  requireThat(cursor === end && result.length > 0 && result[0].data.length === header.headerBytes, 'NSIS: header/block layout')
  return result
}

function applyNativeIconPatches (prefix, block, resources, expectedImages) {
  const patched = Buffer.from(prefix)
  const records = []
  let cursor = 0
  while (true) {
    const size = u32(block, cursor)
    if (size === 0) {
      requireThat(cursor + 4 === block.length, 'patch: terminator/trailing data')
      break
    }
    // EW_WRITEUNINSTALLER tests the first BYTE, unlike generate_unicons_offsets.
    requireThat((size & 255) !== 0, 'patch: native first-byte terminator ambiguity')
    requireThat(records.length <= 32, 'patch: record count')
    const offset = u32(block, cursor + 4)
    const data = range(block, cursor + 8, size, 'patch data')
    const index = records.length
    const matches = resources.leaves.filter(leaf => leaf.type === (index ? 3 : 14) &&
      leaf.id === (index || 103) && leaf.lang === 1033 && leaf.offset === offset &&
      size <= leaf.bytes && (index !== 0 || size === leaf.bytes))
    requireThat(matches.length === 1, 'patch: expected icon resource target required')
    for (const previous of records) {
      requireThat(offset >= previous.offset + previous.bytes || previous.offset >= offset + size, 'patch: overlapping writes')
    }
    range(patched, offset, size, 'patch destination')
    records.push({ offset, bytes: size, noOp: range(prefix, offset, size, 'original icon').equals(data), sha256: sha256(data) })
    data.copy(patched, offset)
    cursor += 8 + size
  }
  requireThat(records.length === expectedImages.length + 1, 'patch: icon record count')
  const groupLeaf = resources.leaves.find(leaf => leaf.type === 14 && leaf.id === 103 && leaf.lang === 1033)
  const group = range(patched, groupLeaf.offset, groupLeaf.bytes, 'patched icon group')
  requireThat(u16(group, 0) === 0 && u16(group, 2) === 1 && u16(group, 4) === expectedImages.length &&
    group.length === 6 + expectedImages.length * 14, 'patch: icon group layout')
  const remaining = expectedImages.map(image => `${image.metadata}/${image.bytes}/${image.sha256}`)
  const ids = new Set()
  for (let i = 0; i < expectedImages.length; i++) {
    const entry = 6 + i * 14
    const id = u16(group, entry + 12)
    const bytes = u32(group, entry + 8)
    const leaf = resources.leaves.find(item => item.type === 3 && item.id === id && item.lang === 1033)
    requireThat(leaf && !ids.has(id) && bytes > 0 && bytes <= leaf.bytes, 'patch: icon group references')
    ids.add(id)
    const key = `${range(group, entry, 8, 'group metadata').toString('hex')}/${bytes}/${sha256(range(patched, leaf.offset, bytes, 'patched icon image'))}`
    const match = remaining.indexOf(key)
    requireThat(match !== -1, 'patch: icon bytes/metadata do not match pinned ICO')
    remaining.splice(match, 1)
  }
  return { patched, records }
}

function reconstruct (input, options) {
  requireThat(Buffer.isBuffer(input) && input.length <= MAX_INPUT, 'input: bounded Buffer required')
  const { expectedInputSha256, expectedIconSha256, expectedCompilerSha256, icon } = options
  requireThat(expectedCompilerSha256 === COMPILER_SHA256, 'compiler: exact validated NSIS ABI required')
  requireThat(Buffer.isBuffer(icon) && icon.length <= 2 * 1024 * 1024, 'ICO: bounded Buffer required')
  checkDigest(input, expectedInputSha256, 'input')
  checkDigest(icon, expectedIconSha256, 'ICO')
  const expectedImages = icoImages(icon)
  const resources = peResources(input)
  const manifest = adminManifest(input, resources)
  const prefix = range(input, 0, resources.prefixBytes, 'PE prefix')
  const outer = range(input, resources.prefixBytes, input.length - resources.prefixBytes, 'outer NSIS')
  const outerHeader = firstHeader(outer, false)
  requireThat(crc32(range(input, 512, input.length - 516, 'outer CRC range')) === u32(input, input.length - 4), 'outer CRC: mismatch')
  const budget = { bytes: 0 }
  const blocks = frames(outer, outerHeader, budget)
  const candidates = blocks.map((block, index) => ({ block, index })).filter(({ block }) =>
    block.data.length >= 20 && range(block.data, 4, 16, 'candidate signature').equals(SIGNATURE))
  requireThat(candidates.length === 1, 'NSIS: unique nested uninstaller required')
  const { block: innerBlock, index } = candidates[0]
  // Supported v304 compiler tail: unicon block, then udata; deduplicated/reordered
  // tails are rejected, not guessed. Both buffers must consume complete frames.
  requireThat(index >= 2 && index === blocks.length - 1, 'NSIS: unsupported uninstaller/patch tail')
  const inner = innerBlock.data
  const innerHeader = firstHeader(inner, true)
  const innerBlocks = frames(inner, innerHeader, budget)
  const writerHeader = blocks[0].data
  range(writerHeader, 0, 52, 'NSIS x86 visible header')
  const entriesOffset = u32(writerHeader, 20)
  const entryCount = u32(writerHeader, 24)
  requireThat(entriesOffset >= 52 && entryCount > 0 && entryCount <= 100000, 'NSIS: entry table bounds')
  range(writerHeader, entriesOffset, entryCount * 28, 'NSIS entries')
  const writes = []
  for (let i = 0; i < entryCount; i++) {
    const at = entriesOffset + i * 28
    // Opcode 62 and the visible x86 entry ABI are bound to the exact compiler
    // above by both retained one-WriteUninstaller fixtures, not a generic enum.
    if (u32(writerHeader, at) === 62) writes.push({ at, index: i })
  }
  const patchDataOffset = blocks[index - 1].cursor - (blocks[0].cursor + 4 + blocks[0].storedBytes)
  requireThat(writes.length === 1 && u32(writerHeader, writes[0].at + 8) === patchDataOffset &&
    u32(writerHeader, writes[0].at + 12) === blocks[index - 1].data.length, 'NSIS: WriteUninstaller operands/tail mismatch')
  const { patched, records } = applyNativeIconPatches(prefix, blocks[index - 1].data, resources, expectedImages)
  const patchedResources = peResources(patched)
  const finalManifest = adminManifest(patched, patchedResources)
  requireThat(finalManifest.sha256 === manifest.sha256, 'manifest: changed by patch')
  const output = Buffer.concat([patched, inner])
  const actualCrc = crc32(range(output, 512, output.length - 516, 'uninstaller CRC range'))
  requireThat(actualCrc === u32(output, output.length - 4), 'uninstaller CRC: compiler-supplied CRC mismatch')
  return {
    output,
    evidence: {
      format: 'NSIS-v304-x86-PE32-nonsolid-raw-deflate-CRC',
      compilerSha256: COMPILER_SHA256,
      writeUninstaller: { opcode: 62, entryIndex: writes[0].index, patchDataOffset, patchBytes: blocks[index - 1].data.length },
      inputSha256: sha256(input),
      outputSha256: sha256(output),
      iconSha256: sha256(icon),
      inputBytes: input.length,
      outputBytes: output.length,
      prefixBytes: prefix.length,
      outerBlocks: blocks.length,
      innerBlocks: innerBlocks.length,
      patchBlockOffset: resources.prefixBytes + blocks[index - 1].cursor,
      patchBytes: blocks[index - 1].data.length,
      patches: records,
      compilerCrc32: actualCrc.toString(16).padStart(8, '0'),
      manifest: finalManifest,
      execution: false
    }
  }
}

function ownedPath (file, output) {
  requireThat(typeof file === 'string' && path.isAbsolute(file) && path.resolve(file) === file, 'path: absolute canonical path required')
  const relative = path.relative(OWNER, file)
  requireThat(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), 'path: outside owner')
  if (output) requireThat(['output', 'test-output'].includes(relative.split(path.sep)[0]), 'path: output root not authorized')
  const rootStat = fs.lstatSync(OWNER, { bigint: true })
  requireThat(rootStat.isDirectory() && !rootStat.isSymbolicLink() &&
    fs.realpathSync.native(OWNER).toLowerCase() === OWNER.toLowerCase(), 'path: noncanonical owner root')
  let current = OWNER
  const parts = relative.split(path.sep)
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i])
    let stat
    try {
      stat = fs.lstatSync(current, { bigint: true })
    } catch (error) {
      if (output && i === parts.length - 1 && error.code === 'ENOENT') return
      throw error
    }
    requireThat(!stat.isSymbolicLink() && fs.realpathSync.native(current).toLowerCase() === current.toLowerCase(), 'path: reparse/alias not supported')
    if (i < parts.length - 1) requireThat(stat.isDirectory(), 'path: ancestor not directory')
    else {
      requireThat(!output, 'output: already exists')
      requireThat(stat.isFile() && stat.nlink === 1n && stat.size <= BigInt(MAX_INPUT), 'input: regular single-link bounded file required')
    }
  }
}

function sameFile (a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.nlink === b.nlink
}

function writeUninstaller (options) {
  const { inputPath, outputPath } = options
  ownedPath(inputPath, false)
  ownedPath(outputPath, true)
  const inputFd = fs.openSync(inputPath, 'r')
  let outputFd
  let created = false
  let written = 0
  try {
    const before = fs.fstatSync(inputFd, { bigint: true })
    requireThat(sameFile(before, fs.lstatSync(inputPath, { bigint: true })), 'input: identity changed')
    const input = fs.readFileSync(inputFd)
    const result = reconstruct(input, options)
    const free = fs.statfsSync(OWNER, { bigint: true })
    const needed = FLOOR + BigInt(Math.ceil(result.output.length / 4096) * 4096 + 16384)
    requireThat(free.bavail * free.bsize >= needed, 'capacity: 512MiB floor plus output/metadata required')
    ownedPath(outputPath, true)
    outputFd = fs.openSync(outputPath, 'wx', 0o600)
    created = true
    const initial = fs.fstatSync(outputFd, { bigint: true })
    requireThat(initial.isFile() && initial.nlink === 1n && initial.size === 0n, 'output: exclusive regular file required')
    while (written < result.output.length) {
      const count = fs.writeSync(outputFd, result.output, written, result.output.length - written)
      requireThat(count > 0, 'output: partial write')
      written += count
    }
    fs.fsyncSync(outputFd)
    fs.closeSync(outputFd)
    outputFd = undefined
    requireThat(sameFile(before, fs.fstatSync(inputFd, { bigint: true })) &&
      sameFile(before, fs.lstatSync(inputPath, { bigint: true })), 'input: changed during reconstruction')
    checkDigest(fs.readFileSync(inputPath), options.expectedInputSha256, 'input after')
    ownedPath(outputPath, false)
    const final = fs.lstatSync(outputPath, { bigint: true })
    requireThat(final.ino === initial.ino && final.dev === initial.dev &&
      final.size === BigInt(result.output.length), 'output: identity/length changed')
    checkDigest(fs.readFileSync(outputPath), result.evidence.outputSha256, 'output after')
    const afterFree = fs.statfsSync(OWNER, { bigint: true })
    requireThat(afterFree.bavail * afterFree.bsize >= FLOOR, 'capacity: floor lost after write')
    return { ...result.evidence, inputPath, outputPath, freeAfterBytes: String(afterFree.bavail * afterFree.bsize) }
  } catch (error) {
    if (created) error.retainedFailure = { outputPath, writtenBytes: written, accepted: false }
    throw error
  } finally {
    if (outputFd !== undefined) fs.closeSync(outputFd)
    fs.closeSync(inputFd)
  }
}

module.exports = { reconstruct, writeUninstaller, crc32, sha256, COMPILER_SHA256 }
