const { test } = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { clickSidebarSection, clickSettingTab, checkRendererNavigation, captureFirstSubtestFailure } = require('../packaged/lib/renderer-navigation')
const { checkUIDataFlows } = require('../packaged/lib/ui-data-flows')

function sidebarPage (name, click) {
  return {
    getByRole (role, options) {
      assert.equal(role, 'navigation')
      assert.deepEqual(options, { name: 'Application sections', exact: true })
      return {
        getByRole (role, options) {
          assert.equal(role, 'button')
          assert.deepEqual(options, { name, exact: true })
          return { click }
        }
      }
    }
  }
}

for (const name of ['About', 'Setting']) {
  test(`packaged navigation awaits the actual ${name} sidebar button click`, async () => {
    let clicked = false
    const page = sidebarPage(name, async () => {
      await Promise.resolve()
      clicked = true
    })
    await clickSidebarSection(page, name)
    assert.equal(clicked, true)
  })
}

for (const [name, run] of [
  ['About', checkRendererNavigation],
  ['Setting', checkUIDataFlows]
]) {
  test(`packaged ${name} flow uses the shared sidebar click and propagates action failure`, async () => {
    const failure = new Error(`${name} button is not actionable`)
    const page = sidebarPage(name, async () => { throw failure })
    const context = { test: async (name, action) => action() }
    await assert.rejects(run(page, context), error => error === failure)
  })
}

test('settings tab focuses before the real mouse click and still awaits the requested store state', async () => {
  const calls = []
  const page = {
    locator (selector) {
      assert.equal(selector, '.setting-tabs [data-node-key="terminalThemes"] [role="tab"]')
      return {
        async focus () { await Promise.resolve(); calls.push('focus') },
        async click () { assert.deepEqual(calls, ['focus']); calls.push('click') }
      }
    },
    async waitForFunction (predicate, key) {
      assert.equal(typeof predicate, 'function')
      assert.equal(key, 'terminalThemes')
      assert.deepEqual(calls, ['focus', 'click'])
      calls.push('state')
    }
  }
  await clickSettingTab(page, 'terminalThemes')
  assert.deepEqual(calls, ['focus', 'click', 'state'])
})

test('settings tab state failure remains fatal after focusing and clicking', async () => {
  const failure = new Error('terminalThemes did not become active')
  const page = {
    locator: () => ({ focus: async () => {}, click: async () => {} }),
    waitForFunction: async () => { throw failure }
  }
  await assert.rejects(clickSettingTab(page, 'terminalThemes'), error => error === failure)
})

test('first subtest capture still attempts a screenshot when renderer state cannot be read', async t => {
  const messages = []
  t.mock.method(console, 'error', (...args) => messages.push(args))
  let afterEach
  let screenshots = 0
  const captured = captureFirstSubtestFailure({ afterEach: hook => { afterEach = hook } }, () => ({
    isClosed: () => false,
    evaluate: async () => { throw new Error('renderer unavailable') },
    screenshot: async options => {
      assert.deepEqual(options, { path: 'first-failure.png', timeout: 5000 })
      screenshots++
    }
  }), 'first-failure.png')
  await afterEach({ passed: true, name: 'passed' })
  assert.equal(captured(), false)
  await afterEach({ passed: false, name: 'first failed' })
  await afterEach({ passed: false, name: 'later failed' })
  assert.equal(captured(), true)
  assert.equal(screenshots, 1)
  assert.equal(messages.length, 1)
  assert.match(messages[0][0], /Cannot read first packaged subtest failure state/)
})

test('real nested Node subtest failure captures its first state before the parent continues', () => {
  const result = spawnSync(process.execPath, ['-e', `
    const { test } = require('node:test')
    const assert = require('node:assert/strict')
    const { captureFirstSubtestFailure } = require(${JSON.stringify(require.resolve('../packaged/lib/renderer-navigation'))})
    test('diagnostic probe parent', async t => {
      captureFirstSubtestFailure(t, () => ({
        isClosed: () => false,
        evaluate: async () => ({ settingTab: 'triggers', selectedTabs: ['triggers'] }),
        screenshot: async ({ path }) => console.log('SCREENSHOT', path)
      }), 'first-failure.png')
      await t.test('passing probe', () => {})
      await t.test('first failing probe', () => assert.fail('intentional diagnostic probe'))
      await t.test('later failing probe', () => assert.fail('intentional later probe'))
      console.log('PARENT_BODY_COMPLETED')
    })
  `], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  const output = result.stdout + result.stderr
  assert.match(output, /PARENT_BODY_COMPLETED/)
  assert.equal((output.match(/SCREENSHOT first-failure.png/g) || []).length, 1)
  assert(result.stdout.indexOf('SCREENSHOT first-failure.png') < result.stdout.indexOf('PARENT_BODY_COMPLETED'))
  const diagnostics = output.split('\n').filter(line => line.includes('First packaged subtest failure:'))
  assert.equal(diagnostics.length, 1)
  assert.match(diagnostics[0], /"test":"first failing probe"/)
  assert.match(diagnostics[0], /"settingTab":"triggers","selectedTabs":\["triggers"\]/)
})
