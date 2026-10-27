'use strict'

const fs = require('node:fs')
const path = require('node:path')

function configureIsolatedUserData (app, env = process.env) {
  const value = env.ANUBIS_USER_DATA_DIR
  if (!value) return null
  if (!path.isAbsolute(value)) {
    throw new Error('ANUBIS_USER_DATA_DIR must be an absolute path')
  }
  const directory = path.resolve(value)
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const stat = fs.lstatSync(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('ANUBIS_USER_DATA_DIR must be a real directory')
  }
  app.setPath('userData', directory)
  if (!env.DATA_PATH) env.DATA_PATH = directory
  return directory
}

module.exports = { configureIsolatedUserData }
