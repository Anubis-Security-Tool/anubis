const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const stylus = require('stylus')

const client = path.resolve(__dirname, '../../client')
const read = file => fs.readFileSync(path.join(client, file), 'utf8')
const compile = file => stylus.render(read(file))

test('sidebar, menu and tab surfaces use the content palette rather than a separate dark strip', () => {
  const sidebar = compile('components/sidebar/sidebar.styl')
  const groups = compile('components/sidebar/menu-preview.styl')
  const menu = compile('components/sys-menu/sys-menu.styl')
  const tabs = compile('components/tabs/tabs.styl')
  assert.match(sidebar, /\.sidebar\s*\{[^}]*background: var\(--main\)/)
  assert.match(sidebar, /\.btns\s*\{[^}]*background: var\(--main\)/)
  assert.match(groups, /\.preview-menu-item\.active\s*\{[^}]*background: var\(--main-light\)/)
  assert.match(menu, /\.context-menu\s*\{[^}]*color: var\(--text\);[^}]*background: var\(--main\)/)
  assert.match(menu, /\.context-item\.disabled:hover\s*\{[^}]*color: var\(--text-disabled\);[^}]*background: transparent/)
  assert.match(tabs, /\.tabs\s*\{[^}]*background: var\(--main\)/)
  assert.match(tabs, /\.window-controls\s*\{[^}]*background: var\(--main\)/)
  assert.match(tabs, /\.window-control-maximize:hover\s*\{[^}]*background: var\(--main-light\)/)
  assert.match(tabs, /\.icon-maximize\.is-max:before\s*\{[^}]*border: 1px solid var\(--text\)/)
  assert.match(compile('css/includes/theme.styl'), /--border: var\(--ui-border\)/)
  assert.doesNotMatch(menu, /#333|#777/)
})

test('popover content and arrows follow dark, light and custom theme colors without changing other component tokens', () => {
  const source = read('store/store.js')
  const getter = source.slice(source.indexOf('get uiThemeConfig ()'), source.indexOf('get bookmarkTree ()'))
  for (const main of ['#1B1B1B', '#ededed', '#273649']) {
    const palette = { main, text: main === '#ededed' ? '#555555' : '#E8E8E8', primary: '#22D3EE' }
    const context = {
      window: { store: { getUiThemeConfig: () => palette } },
      isColorDark: value => value !== '#ededed',
      theme: { darkAlgorithm: 'dark', defaultAlgorithm: 'light' }
    }
    const config = vm.runInNewContext(`({ ${getter} }).uiThemeConfig`, context)
    assert.equal(config.components.Popover.colorBgElevated, main)
    assert.equal(config.components.Popover.colorText, palette.text)
    assert.equal(config.token.colorBgBase, main)
    assert.equal(config.token.colorTextBase, palette.text)
    assert.equal(config.token.motion, false)
    assert.deepEqual(Object.keys(config.components), ['Popover'])
    assert.equal(config.algorithm, main === '#ededed' ? 'light' : 'dark')
  }
})
