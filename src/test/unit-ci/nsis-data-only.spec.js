'use strict'

const assert = require('node:assert/strict')
const zlib = require('node:zlib')
const test = require('node:test')
const { reconstruct, crc32, sha256, COMPILER_SHA256 } = require('../../build/bin/nsis/data-only-uninstaller.cjs')

// This independent bitwise oracle generates byte fixtures, never executable code.
function oracleCrc (bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

const word = value => {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32LE(value >>> 0)
  return buffer
}

function frame (bytes, compressed = false) {
  const data = compressed ? zlib.deflateRawSync(bytes) : bytes
  return Buffer.concat([word(data.length | (compressed ? 0x80000000 : 0)), data])
}

function container (prefix, flags, blocks) {
  const header = Buffer.alloc(28)
  header.writeUInt32LE(flags)
  Buffer.from('efbeadde4e756c6c736f6674496e7374', 'hex').copy(header, 4)
  header.writeUInt32LE(128, 20)
  header.writeUInt32LE(28 + blocks.reduce((sum, block) => sum + block.length, 0) + 4, 24)
  const body = Buffer.concat([header, ...blocks])
  const crc = oracleCrc(Buffer.concat([prefix.subarray(512), body]))
  return Buffer.concat([body, word(crc)])
}

function fixture () {
  const prefix = Buffer.alloc(3072)
  prefix.write('MZ')
  prefix.writeUInt32LE(128, 60)
  prefix.write('PE\0\0', 128)
  prefix.writeUInt16LE(0x14c, 132)
  prefix.writeUInt16LE(2, 134)
  prefix.writeUInt16LE(224, 148)
  const optional = 152
  prefix.writeUInt16LE(0x10b, optional)
  prefix.writeUInt32LE(512, optional + 36)
  prefix.writeUInt32LE(512, optional + 60)
  prefix.writeUInt32LE(16, optional + 92)
  prefix.writeUInt32LE(0x2000, optional + 112)
  prefix.writeUInt32LE(2048, optional + 116)
  for (const [i, name, rva, size, offset] of [[0, '.text', 0x1000, 512, 512], [1, '.rsrc', 0x2000, 2048, 1024]]) {
    const entry = 376 + i * 40
    prefix.write(name, entry)
    prefix.writeUInt32LE(size, entry + 8)
    prefix.writeUInt32LE(rva, entry + 12)
    prefix.writeUInt32LE(size, entry + 16)
    prefix.writeUInt32LE(offset, entry + 20)
  }
  const image = Buffer.from('0123456789abcdef!')
  const ico = Buffer.alloc(22 + image.length)
  ico.writeUInt16LE(1, 2)
  ico.writeUInt16LE(1, 4)
  ico[6] = 16
  ico[7] = 16
  ico.writeUInt16LE(1, 10)
  ico.writeUInt16LE(32, 12)
  ico.writeUInt32LE(image.length, 14)
  ico.writeUInt32LE(22, 18)
  image.copy(ico, 22)
  const group = Buffer.alloc(20)
  group.writeUInt16LE(1, 2)
  group.writeUInt16LE(1, 4)
  ico.copy(group, 6, 6, 18)
  group.writeUInt16LE(1, 18)
  const manifest = Buffer.from('<assembly><trustInfo><security><requestedPrivileges><requestedExecutionLevel level="requireAdministrator" uiAccess="false"/></requestedPrivileges></security></trustInfo></assembly>')
  const leaves = [[3, 1, 256, Buffer.alloc(image.length, 0xaa)], [14, 103, 300, group], [24, 1, 400, manifest]]
  const resource = prefix.subarray(1024)
  resource.writeUInt16LE(3, 14)
  for (let i = 0; i < leaves.length; i++) {
    const [type, id, offset, data] = leaves[i]
    const directory = 40 + i * 64
    resource.writeUInt32LE(type, 16 + i * 8)
    resource.writeUInt32LE((directory | 0x80000000) >>> 0, 20 + i * 8)
    resource.writeUInt16LE(1, directory + 14)
    resource.writeUInt32LE(id, directory + 16)
    resource.writeUInt32LE(((directory + 24) | 0x80000000) >>> 0, directory + 20)
    resource.writeUInt16LE(1, directory + 38)
    resource.writeUInt32LE(1033, directory + 40)
    resource.writeUInt32LE(directory + 48, directory + 44)
    resource.writeUInt32LE(0x2000 + offset, directory + 48)
    resource.writeUInt32LE(data.length, directory + 52)
    data.copy(resource, offset)
  }
  const patch = Buffer.concat([word(group.length), word(1324), group, word(image.length), word(1280), image, word(0)])
  const patched = Buffer.from(prefix)
  image.copy(patched, 1280)
  const inner = container(patched, 9, [frame(Buffer.alloc(128, 1), true), frame(Buffer.from('inert test bytes'))])
  const writerHeader = Buffer.alloc(128)
  writerHeader.writeUInt32LE(64, 20)
  writerHeader.writeUInt32LE(1, 24)
  writerHeader.writeUInt32LE(62, 64)
  writerHeader.writeUInt32LE(4, 72)
  writerHeader.writeUInt32LE(patch.length, 76)
  const blocks = [frame(writerHeader, true), frame(Buffer.alloc(0)), frame(patch, true), frame(inner, true)]
  const input = Buffer.concat([prefix, container(prefix, 8, blocks)])
  return {
    prefix,
    patched,
    patch,
    inner,
    blocks,
    input,
    ico,
    writerHeader,
    options: { expectedInputSha256: sha256(input), expectedIconSha256: sha256(ico), expectedCompilerSha256: COMPILER_SHA256, icon: ico }
  }
}

function expectBad (change, pattern, syncOperands = true) {
  const f = fixture()
  change(f)
  if (syncOperands) {
    const stored = f.blocks[2].subarray(4)
    const data = (f.blocks[2].readUInt32LE() >>> 31) ? zlib.inflateRawSync(stored) : stored
    f.writerHeader.writeUInt32LE(data.length, 76)
  }
  f.blocks[0] = frame(f.writerHeader, true)
  const input = Buffer.concat([f.prefix, container(f.prefix, 8, f.blocks)])
  assert.throws(() => reconstruct(input, { ...f.options, expectedInputSha256: sha256(input) }), pattern)
}

test('CRC empty vector', () => assert.equal(crc32(Buffer.alloc(0)), 0))
test('CRC canonical vector', () => assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926))
test('CRC incremental vector', () => assert.equal(crc32(Buffer.from('56789'), crc32(Buffer.from('1234'))), 0xcbf43926))
test('CRC independent oracle', () => {
  const bytes = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 37 + 19) & 255))
  assert.equal(crc32(bytes), oracleCrc(bytes))
})
test('exact native patch and append, including empty outer file block', () => {
  const f = fixture()
  const result = reconstruct(f.input, f.options)
  assert.deepEqual(result.output, Buffer.concat([f.patched, f.inner]))
  assert.equal(result.evidence.patches.filter(item => !item.noOp).length, 1)
  assert.equal(result.evidence.manifest.level, 'requireAdministrator')
})
test('all native prefix patches are proven no-op when icons agree', () => {
  const f = fixture()
  f.prefix = f.patched
  const input = Buffer.concat([f.prefix, container(f.prefix, 8, f.blocks)])
  const result = reconstruct(input, { ...f.options, expectedInputSha256: sha256(input) })
  assert(result.evidence.patches.every(item => item.noOp))
})
test('input digest required', () => {
  const f = fixture()
  assert.throws(() => reconstruct(f.input, { ...f.options, expectedInputSha256: '' }), /expected digest/)
})
test('compiler ABI must be explicitly digest-bound', () => {
  const f = fixture()
  assert.throws(() => reconstruct(f.input, { ...f.options, expectedCompilerSha256: '0'.repeat(64) }), /compiler/)
})
test('native instruction must point to exact patch block', () => expectBad(f => {
  f.writerHeader.writeUInt32LE(8, 72)
}, /operands/, false))
test('native instruction must bound exact patch bytes', () => expectBad(f => {
  f.writerHeader.writeUInt32LE(1, 76)
}, /operands/, false))
test('native WriteUninstaller opcode is not guessed for other ABIs', () => expectBad(f => {
  f.writerHeader.writeUInt32LE(63, 64)
}, /operands/, false))
test('multiple WriteUninstaller instructions unsupported', () => expectBad(f => {
  f.writerHeader.writeUInt32LE(2, 24)
  f.writerHeader.copy(f.writerHeader, 92, 64, 92)
}, /operands/, false))
test('entry table range is bounded', () => expectBad(f => {
  f.writerHeader.writeUInt32LE(0xfffffff0, 20)
}, /range/, false))
test('input digest mismatch', () => {
  const f = fixture()
  assert.throws(() => reconstruct(f.input, { ...f.options, expectedInputSha256: '0'.repeat(64) }), /digest mismatch/)
})
test('icon digest mismatch', () => {
  const f = fixture()
  assert.throws(() => reconstruct(f.input, { ...f.options, expectedIconSha256: '0'.repeat(64) }), /digest mismatch/)
})
test('PE DOS signature', () => expectBad(f => { f.prefix[0] = 0 }, /DOS signature/))
test('PE machine ABI', () => expectBad(f => f.prefix.writeUInt16LE(0x8664, 132), /PE32/))
test('PE header outside bounded prefix', () => expectBad(f => f.prefix.writeUInt32LE(0xfffffff0, 60), /header offset/))
test('PE signed overlay unsupported', () => expectBad(f => f.prefix.writeUInt32LE(123, 152 + 128), /signed overlay/))
test('PE overlapping sections', () => expectBad(f => f.prefix.writeUInt32LE(512, 416 + 20), /overlapping raw/))
test('PE resource range', () => expectBad(f => f.prefix.writeUInt32LE(0xffff, 152 + 116), /resource directory/))
test('PE resource directory cycle', () => expectBad(f => f.prefix.writeUInt32LE(0x80000000, 1024 + 20), /depth.*cycle/))
test('PE resource leaf out of resource', () => expectBad(f => f.prefix.writeUInt32LE(0xfffffff0, 1024 + 88), /resource data range/))
test('admin manifest cannot be downgraded', () => expectBad(f => {
  const offset = f.prefix.indexOf(Buffer.from('requireAdministrator'))
  f.prefix.write('asInvoker           ', offset)
}, /admin level/))
test('outer compiler CRC mismatch', () => {
  const f = fixture()
  f.input[f.input.length - 1] ^= 1
  assert.throws(() => reconstruct(f.input, { ...f.options, expectedInputSha256: sha256(f.input) }), /outer CRC/)
})
test('multiple inner uninstaller candidates', () => expectBad(f => f.blocks.push(frame(f.inner)), /unique nested/))
test('missing inner uninstaller', () => expectBad(f => f.blocks.pop(), /unique nested/))
test('uninstaller is not final block', () => expectBad(f => f.blocks.push(frame(Buffer.from('extra'))), /unsupported uninstaller/))
test('inner declared length mismatch', () => expectBad(f => {
  f.inner.writeUInt32LE(f.inner.length + 1, 24)
  f.blocks[3] = frame(f.inner)
}, /declared lengths/))
test('inner no-CRC flag unsupported', () => expectBad(f => {
  f.inner.writeUInt32LE(5, 0)
  f.blocks[3] = frame(f.inner)
}, /unsupported flags/))
test('inner CRC cannot be repaired or ignored', () => expectBad(f => {
  f.inner[f.inner.length - 1] ^= 1
  f.blocks[3] = frame(f.inner)
}, /compiler-supplied CRC/))
test('patch target outside PE/resources', () => expectBad(f => {
  f.patch.writeUInt32LE(0xfffffff0, 4)
  f.blocks[2] = frame(f.patch)
}, /expected icon resource target/))
test('patch cannot target admin manifest', () => expectBad(f => {
  f.patch.writeUInt32LE(1424, 4)
  f.blocks[2] = frame(f.patch)
}, /expected icon resource target/))
test('patch native first-byte termination ambiguity', () => expectBad(f => {
  f.patch.writeUInt32LE(256, 0)
  f.blocks[2] = frame(f.patch)
}, /first-byte terminator/))
test('patch DWORD terminator must consume complete block', () => expectBad(f => {
  f.blocks[2] = frame(Buffer.concat([f.patch, word(0)]))
}, /terminator.*trailing/))
test('partial patch record must fail', () => expectBad(f => {
  f.blocks[2] = frame(f.patch.subarray(0, f.patch.length - 5))
}, /range/))
test('patch images must match pinned ICO', () => expectBad(f => {
  f.patch[f.patch.length - 5] ^= 1
  f.blocks[2] = frame(f.patch)
}, /icon bytes.*metadata/))
test('patch group references must be unique and valid', () => expectBad(f => {
  f.patch.writeUInt16LE(99, 8 + 18)
  f.blocks[2] = frame(f.patch)
}, /icon group references/))
test('compressed block trailing junk must fail', () => expectBad(f => {
  const data = Buffer.concat([zlib.deflateRawSync(f.patch), Buffer.from([1, 2, 3])])
  f.blocks[2] = Buffer.concat([word(data.length | 0x80000000), data])
}, /trailing compressed/))
test('inflate output bound', () => expectBad(f => {
  f.blocks[2] = frame(Buffer.alloc(8 * 1024 * 1024 + 1), true)
}, /larger than|output length|buffer length|Cannot create/i))
test('truncated block cannot become a partial append', () => expectBad(f => {
  f.blocks[3] = f.blocks[3].subarray(0, f.blocks[3].length - 1)
}, /block range/))
test('NSIS file overlays rejected', () => {
  const f = fixture()
  const input = Buffer.concat([f.input, word(0)])
  assert.throws(() => reconstruct(input, { ...f.options, expectedInputSha256: sha256(input) }), /declared lengths/)
})
