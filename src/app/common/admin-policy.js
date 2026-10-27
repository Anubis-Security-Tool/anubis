/**
 * Admin-level policy (see fork/docs/ADMIN-VS-USER.md).
 *
 * Values are fixed at build time (brand.config.js) or by environment
 * variables ANUBIS_ADMIN_* present at (first) start. They are forced into the
 * user config on every start, on every config read and on every config save,
 * so editing them through the UI, the IPC API or the config file has no
 * lasting effect. Secrets (MCP token) are never in brand.config.js: they are
 * generated on first start and kept in userData.
 *
 * Keep ADMIN_LOCKABLE_KEYS in sync with src/client/common/admin-policy.js
 * (checked by the unit test admin-policy.spec.js).
 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const brand = require('./brand')

const ADMIN_LOCKABLE_KEYS = [
  'syncSetting.cloudApiUrl',
  'syncSetting.customApiUrl',
  'syncSetting.customAccessToken',
  'syncSetting.customGistId',
  'baseURLAI',
  'apiPathAI',
  'authHeaderNameAI',
  'enableGlobalProxy',
  'proxy',
  'checkUpdateOnStart',
  'mcpServerEnabled',
  'errorReportEnabled',
  'errorReportUrl',
  'autoStartOnLogin'
]

const MCP_TOKEN_FILE = 'admin-mcp-token'

function envBool (v, fallback) {
  if (v === undefined || v === '') {
    return fallback
  }
  return !['0', 'false', 'no', 'off'].includes(String(v).trim().toLowerCase())
}

function envStr (v, fallback) {
  return v === undefined || v === '' ? fallback : String(v).trim()
}

function apiBase () {
  return brand.domains.api || `https://api.${new URL(brand.domains.site).hostname}`
}

function validateLocalSyncSettings (apiUrl, secret, userId) {
  let url
  try {
    url = new URL(apiUrl)
  } catch {
    throw new Error('ANUBIS_ADMIN_CUSTOM_SYNC_API must be a loopback /api/sync URL')
  }
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.pathname !== '/api/sync' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('ANUBIS_ADMIN_CUSTOM_SYNC_API must be a loopback /api/sync URL')
  }
  if (secret.length < 32 || /\s/.test(secret)) {
    throw new Error('ANUBIS_ADMIN_CUSTOM_SYNC_SECRET must contain at least 32 non-whitespace characters')
  }
  if (!/^[A-Za-z0-9._-]{8,100}$/.test(userId)) {
    throw new Error('ANUBIS_ADMIN_CUSTOM_SYNC_USER must be 8-100 safe identifier characters')
  }
}

/**
 * @returns {{ values: object, locked: string[] }}
 *   values: dotted key -> forced value; locked: keys hidden/read-only in UI
 */
function getAdminPolicy (env = process.env) {
  const values = {
    'syncSetting.cloudApiUrl': envStr(env.ANUBIS_ADMIN_SYNC_API, brand.sync.cloudApi),
    baseURLAI: envStr(env.ANUBIS_ADMIN_AI_BASE_URL, brand.ai.baseURL),
    apiPathAI: '/chat/completions',
    authHeaderNameAI: 'Authorization: Bearer',
    checkUpdateOnStart: envBool(env.ANUBIS_ADMIN_UPDATE_ENABLED, brand.update.enabled),
    mcpServerEnabled: envBool(env.ANUBIS_ADMIN_MCP_ENABLED, true),
    errorReportEnabled: envBool(env.ANUBIS_ADMIN_ERROR_REPORT, true),
    errorReportUrl: envStr(env.ANUBIS_ADMIN_ERROR_REPORT_URL, `${apiBase()}/api/report`),
    autoStartOnLogin: envBool(env.ANUBIS_ADMIN_AUTOSTART, true)
  }
  const locked = Object.keys(values)
  const customSyncApi = envStr(env.ANUBIS_ADMIN_CUSTOM_SYNC_API, '')
  const customSyncSecret = envStr(env.ANUBIS_ADMIN_CUSTOM_SYNC_SECRET, '')
  const customSyncUser = envStr(env.ANUBIS_ADMIN_CUSTOM_SYNC_USER, '')
  const customSyncValues = [customSyncApi, customSyncSecret, customSyncUser]
  if (customSyncValues.some(Boolean)) {
    if (!customSyncValues.every(Boolean)) {
      throw new Error('Local custom sync requires ANUBIS_ADMIN_CUSTOM_SYNC_API, ANUBIS_ADMIN_CUSTOM_SYNC_SECRET and ANUBIS_ADMIN_CUSTOM_SYNC_USER together')
    }
    validateLocalSyncSettings(customSyncApi, customSyncSecret, customSyncUser)
    values['syncSetting.customApiUrl'] = customSyncApi
    values['syncSetting.customAccessToken'] = customSyncSecret
    values['syncSetting.customGistId'] = customSyncUser
    locked.push('syncSetting.customApiUrl', 'syncSetting.customAccessToken', 'syncSetting.customGistId')
  }
  // proxy is enforced only when the admin provides one
  const proxy = envStr(env.ANUBIS_ADMIN_PROXY, '')
  if (proxy) {
    values.enableGlobalProxy = true
    values.proxy = proxy
    locked.push('enableGlobalProxy', 'proxy')
  }
  // autostart is admin-locked unless the admin explicitly lets the user opt out
  if (envBool(env.ANUBIS_ADMIN_AUTOSTART_USER_CAN_DISABLE, false)) {
    locked.splice(locked.indexOf('autoStartOnLogin'), 1)
  }
  return { values, locked }
}

function setPath (obj, dotted, value) {
  const parts = dotted.split('.')
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') {
      cur[parts[i]] = {}
    }
    cur = cur[parts[i]]
  }
  cur[parts[parts.length - 1]] = value
}

function hasPath (obj, dotted) {
  const parts = dotted.split('.')
  let cur = obj
  for (const p of parts) {
    if (!cur || typeof cur !== 'object' || !(p in cur)) {
      return false
    }
    cur = cur[p]
  }
  return true
}

/**
 * Returns a copy of `config` with admin values forced in.
 * Keys that the user may change (unlocked) are only defaulted when absent.
 * partial=true: config is a partial update, so a nested key is forced only
 * when its parent object is present (avoids clobbering the whole parent).
 */
function applyAdminPolicy (config, { partial = false, env = process.env } = {}) {
  const { values, locked } = getAdminPolicy(env)
  const res = { ...config }
  for (const key of Object.keys(values)) {
    const isNested = key.includes('.')
    const root = key.split('.')[0]
    if (!locked.includes(key)) {
      if (!partial && !hasPath(res, key)) {
        setPath(res, key, values[key])
      }
      continue
    }
    if (isNested) {
      if (partial && !(root in res)) {
        continue
      }
      res[root] = { ...(res[root] || {}) }
    }
    setPath(res, key, values[key])
  }
  return res
}

function getAdminLockedKeys (env = process.env) {
  return getAdminPolicy(env).locked
}

/**
 * Per-installation MCP token, created on first call. Stored in userData
 * (owner-only on POSIX), never in source.
 */
function ensureMcpToken (dir) {
  const file = path.join(dir, MCP_TOKEN_FILE)
  const read = () => {
    const token = fs.readFileSync(file, 'utf8').trim()
    if (!/^[0-9a-f]{64}$/.test(token)) {
      throw new Error(`Invalid administrator MCP token in ${file}`)
    }
    return token
  }
  try {
    return read()
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
  }
  const token = crypto.randomBytes(32).toString('hex')
  fs.mkdirSync(dir, { recursive: true })
  try {
    fs.writeFileSync(file, token, { mode: 0o600, flag: 'wx' })
  } catch (e) {
    if (e.code === 'EEXIST') return read()
    throw e
  }
  return token
}

function getUserDataDir () {
  return require('electron').app.getPath('userData')
}

function getMcpToken () {
  return ensureMcpToken(getUserDataDir())
}

module.exports = {
  ADMIN_LOCKABLE_KEYS,
  MCP_TOKEN_FILE,
  getAdminPolicy,
  getAdminLockedKeys,
  applyAdminPolicy,
  ensureMcpToken,
  getMcpToken
}
