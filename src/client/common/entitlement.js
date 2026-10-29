// Pure entitlement predicate for the Browser PRO gate.
//
// Kept as a CommonJS module (not the ESM style used by the JSX components) so
// the same predicate can be unit-tested directly with `node --test` in
// src/test/unit-ci while still being imported by the renderer (menu-preview /
// web-session) through the Vite CJS interop layer. No DOM, no Electron.
//
// Entitlement contract (shared with the managed controller):
//   entitled = pro === true && (proExpiresAt == null || proExpiresAt > now)
function isEntitled (status) {
  return !!status && status.pro === true &&
    (status.proExpiresAt == null || status.proExpiresAt > Date.now())
}

module.exports = { isEntitled }
