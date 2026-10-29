// Pure, side-effect-free helpers for the RBI "Browser tools" panel.
//
// Kept as a CommonJS module (not the ESM style used by the JSX components) so
// the same functions can be unit-tested directly with `node --test` in
// src/test/unit-ci, while still being imported by browser-panel.jsx through the
// webpack interop layer. Nothing here touches the DOM or Electron.

// User-agent presets offered in the panel. An empty `value` means "let the
// server apply its realistic default UA" (blank = default). `value: null`
// marks the Custom entry, which reveals the free-text input.
const UA_PRESETS = [
  { key: 'default', label: 'Default (realistic Chrome)', value: '' },
  {
    key: 'win-chrome',
    label: 'Windows Chrome',
    value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  },
  {
    key: 'mac-safari',
    label: 'macOS Safari',
    value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15'
  },
  { key: 'custom', label: 'Custom', value: null }
]

function isString (v) {
  return typeof v === 'string'
}

function isNonEmptyString (v) {
  return isString(v) && v.trim().length > 0
}

// Build a profile bundle from the current active user agent and the cookies
// just exported from the session. Throws on an unusable name so the caller can
// surface a clear error toast.
function buildProfile ({ name, userAgent, cookies }) {
  if (!isNonEmptyString(name)) {
    throw new Error('Profile name is required')
  }
  return {
    name: name.trim(),
    userAgent: isString(userAgent) ? userAgent : '',
    cookies: Array.isArray(cookies) ? cookies : []
  }
}

// Parse and validate a profile file. Returns a normalized bundle or throws a
// descriptive error.
function parseProfile (text) {
  let data
  try {
    data = JSON.parse(text)
  } catch (e) {
    throw new Error('File is not valid JSON')
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Profile must be a JSON object')
  }
  if (!isNonEmptyString(data.name)) {
    throw new Error('Profile is missing a name')
  }
  if (!Array.isArray(data.cookies)) {
    throw new Error('Profile is missing a cookies array')
  }
  return {
    name: data.name.trim(),
    userAgent: isString(data.userAgent) ? data.userAgent : '',
    cookies: data.cookies
  }
}

// Parse a plain cookies-only JSON file (an array of cookie objects).
function parseCookies (text) {
  let data
  try {
    data = JSON.parse(text)
  } catch (e) {
    throw new Error('File is not valid JSON')
  }
  if (!Array.isArray(data)) {
    throw new Error('Cookies file must be a JSON array')
  }
  return data
}

// Parse and validate an app-vault file (an array of { domain, username,
// password } rows). Unknown fields are dropped; missing strings become ''.
function parseVault (text) {
  let data
  try {
    data = JSON.parse(text)
  } catch (e) {
    throw new Error('File is not valid JSON')
  }
  if (!Array.isArray(data)) {
    throw new Error('Vault file must be a JSON array')
  }
  return data.map(row => ({
    domain: isString(row && row.domain) ? row.domain : '',
    username: isString(row && row.username) ? row.username : '',
    password: isString(row && row.password) ? row.password : ''
  }))
}

// Merge imported vault rows into existing rows, keyed by domain+username.
// Imported rows replace matching existing rows; new rows are appended.
function mergeVault (existing, incoming) {
  const base = Array.isArray(existing) ? existing.slice() : []
  const keyOf = r => `${r.domain}\u0000${r.username}`
  const index = new Map(base.map((r, i) => [keyOf(r), i]))
  for (const row of Array.isArray(incoming) ? incoming : []) {
    const key = keyOf(row)
    if (index.has(key)) base[index.get(key)] = row
    else {
      index.set(key, base.length)
      base.push(row)
    }
  }
  return base
}

// Turn a user-supplied name into a safe file basename.
function sanitizeFileBase (name) {
  const base = isString(name) ? name.trim() : ''
  const safe = base.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return safe || 'profile'
}

module.exports = {
  UA_PRESETS,
  buildProfile,
  parseProfile,
  parseCookies,
  parseVault,
  mergeVault,
  sanitizeFileBase
}
