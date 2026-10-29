const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

function createManagedWebPassword (userData) {
  const directory = path.resolve(userData)
  if (fs.realpathSync(directory).toLowerCase() !== directory.toLowerCase()) {
    throw new Error('Managed Web credentials require a physical profile directory')
  }
  const file = path.join(directory, 'web-user-password.txt')
  const valid = value => typeof value === 'string' && value.length >= 12 &&
    value.length <= 4096 && !/[\r\n]/.test(value) && !value.includes('\0')
  const read = () => {
    const before = fs.lstatSync(file)
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > 16384) {
      throw new Error('Managed Web password file is unavailable')
    }
    const bytes = fs.readFileSync(file)
    const after = fs.lstatSync(file)
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      throw new Error('Managed Web password file changed during authentication')
    }
    const text = bytes.toString('utf8')
    if (!Buffer.from(text).equals(bytes)) throw new Error('Managed Web password file must use UTF-8')
    const password = text.replace(/\r?\n$/, '')
    if (!valid(password)) throw new Error('Managed Web password must contain 12 to 4096 characters on one line')
    return password
  }
  try {
    fs.lstatSync(file)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    const fd = fs.openSync(file, 'wx', 0o600)
    try {
      fs.writeFileSync(fd, crypto.randomBytes(24).toString('base64url') + '\n')
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
  }
  const info = fs.lstatSync(file)
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 16384) {
    throw new Error('Managed Web password file is unavailable')
  }
  const key = crypto.randomBytes(32)
  const digest = value => crypto.createHmac('sha256', key).update(value).digest()
  return {
    file,
    verify (candidate) {
      const expected = read()
      return valid(candidate) && crypto.timingSafeEqual(digest(candidate), digest(expected))
    },
    set (value) {
      if (!valid(value)) throw new Error('Managed Web password must contain 12 to 4096 characters on one line')
      const temporary = file + '.' + crypto.randomBytes(8).toString('hex') + '.next'
      const fd = fs.openSync(temporary, 'wx', 0o600)
      try {
        fs.writeFileSync(fd, value + '\n')
        fs.fsyncSync(fd)
      } finally {
        fs.closeSync(fd)
      }
      try {
        fs.renameSync(temporary, file)
      } catch (error) {
        try { fs.unlinkSync(temporary) } catch (cleanup) { if (cleanup.code !== 'ENOENT') throw cleanup }
        throw error
      }
    }
  }
}

module.exports = { createManagedWebPassword }
