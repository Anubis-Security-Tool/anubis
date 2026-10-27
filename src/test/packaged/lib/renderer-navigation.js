const assert = require('node:assert/strict')

async function clickSidebarSection (page, name) {
  await page.getByRole('navigation', { name: 'Application sections', exact: true })
    .getByRole('button', { name, exact: true }).click()
}

async function clickSettingTab (page, key) {
  const tab = page.locator(`.setting-tabs [data-node-key="${key}"] [role="tab"]`)
  // Focus can move the overflow strip; settle it before calculating click coordinates.
  await tab.focus()
  await tab.click()
  await page.waitForFunction(value => window.store.settingTab === value, key)
}

function captureFirstSubtestFailure (t, getPage, screenshotPath) {
  let captured = false
  t.afterEach(async child => {
    if (child.passed || captured) return
    captured = true
    const page = getPage()
    if (!page || page.isClosed()) {
      console.error('Cannot capture first packaged subtest failure: no open page', child.name)
      return
    }
    await page.evaluate(() => ({
      settingTab: window.store?.settingTab,
      selectedTabs: Array.from(document.querySelectorAll('.setting-tabs [role="tab"][aria-selected="true"]'))
        .map(tab => tab.closest('[data-node-key]')?.getAttribute('data-node-key'))
    })).then(state => {
      console.error('First packaged subtest failure:', JSON.stringify({ test: child.name, ...state }))
    }, error => {
      console.error('Cannot read first packaged subtest failure state:', error)
    })
    await page.screenshot({ path: screenshotPath, timeout: 5000 })
      .catch(error => console.error('Cannot capture first packaged subtest failure screenshot:', error))
  })
  return () => captured
}

async function checkRendererNavigation (page, t) {
  await t.test('the actual About button and every information section render', async () => {
    await clickSidebarSection(page, 'About')
    const modal = page.locator('.info-modal')
    await modal.waitFor()
    for (const tab of await modal.getByRole('tab').all()) {
      await tab.click()
      assert.equal(await tab.getAttribute('aria-selected'), 'true')
    }
    await modal.locator('.custom-modal-close').click()
    await modal.waitFor({ state: 'hidden' })
  })
  await clickSidebarSection(page, 'Setting')
  await page.locator('.setting-wrap input').first().waitFor()
  const sections = {
    bookmarks: '.setting-tabs-bookmarks .tree-item',
    setting: '.setting-tabs-setting .item-list-unit',
    terminalThemes: '#terminal-theme-form_themeName',
    quickCommands: '#commands_0_command',
    triggers: '#matchValue',
    profiles: '.setting-tabs-profile #username'
  }
  for (const [key, selector] of Object.entries(sections)) {
    await t.test(`the ${key} section loads through a real navigation click`, async () => {
      await clickSettingTab(page, key)
      await page.locator('.setting-wrap').locator(selector).first().waitFor({ timeout: 10000 })
      assert.equal(await page.locator('.setting-wrap .common-err-desc').count(), 0)
    })
  }
  await t.test('the widgets section loads through a real navigation click', async () => {
    await clickSettingTab(page, 'widgets')
    await page.getByText('Select a widget to configure', { exact: true }).waitFor()
  })
  await clickSettingTab(page, 'setting')
  for (const category of ['Common', 'Terminal', 'Shortcuts', 'Setting sync', 'AI', 'Password']) {
    await t.test(`the ${category} settings page renders`, async () => {
      const item = page.locator('.setting-tabs-setting .item-list-unit').filter({ hasText: category })
      await item.click()
      await page.waitForFunction(text => {
        const active = document.querySelector('.setting-tabs-setting .item-list-unit.active')
        return active?.textContent.includes(text)
      }, category)
      assert.equal(await page.locator('.setting-wrap .common-err-desc').count(), 0)
    })
  }
  await page.locator('.close-setting-wrap:visible').first().click()
  await page.locator('.setting-wrap').waitFor({ state: 'hidden' })
}

module.exports = { checkRendererNavigation, clickSettingTab, clickSidebarSection, captureFirstSubtestFailure }
