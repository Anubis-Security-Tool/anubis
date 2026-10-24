const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const stylus = require('stylus')

const file = path.resolve(__dirname, '../../client/components/sidebar/menu-preview.styl')
const css = stylus.render(fs.readFileSync(file, 'utf8'))

test('sidebar has readable root rows and a visually nested item hierarchy', () => {
  assert.match(css, /\.preview-brand\s*\{[^}]*height: 64px/)
  assert.match(css, /\.preview-brand \.sidebar-brand-name\s*\{[^}]*font-size: 14px/)
  assert.match(css, /\.preview-group summary\s*\{[^}]*min-height: 40px;[^}]*font-size: 14px/)
  assert.match(css, /\.preview-group\[open\]::before\s*\{[^}]*border-left: 1px solid var\(--border\);[^}]*pointer-events: none/)
  assert.match(css, /\.preview-menu-item\s*\{[^}]*width: calc\(100% - 28px\);[^}]*min-height: 40px;[^}]*margin: 1px 0 1px 28px/)
  assert.match(css, /\.preview-menu-item > svg\s*\{[^}]*width: 20px;[^}]*height: 20px;[^}]*stroke-width: 1\.75/)
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i)
  assert.match(css, /\.preview-group \+ \.preview-group\s*\{[^}]*padding-top: 0;[^}]*border-top: 0/)
})

test('compact, collapsed, footer scrolling and keyboard focus remain explicit', () => {
  assert.match(css, /\.preview-compact \.preview-group\[open\]::before\s*\{\s*display: none/)
  assert.match(css, /\.preview-compact \.preview-menu-item\s*\{[^}]*width: 100%;[^}]*margin-left: 0/)
  assert.match(css, /\.collapsed \.preview-footer\s*\{\s*display: none/)
  assert.match(css, /\.preview-footer\s*\{[^}]*max-height: 40%;[^}]*overflow-y: auto/)
  assert.match(css, /\.preview-group summary:focus-visible\s*\{[^}]*outline: 2px solid var\(--primary\)/)
  assert.match(css, /\.preview-menu-item:focus-visible\s*\{[^}]*outline: 2px solid var\(--primary\)/)
})
