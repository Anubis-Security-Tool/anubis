const { test } = require('node:test')
const assert = require('node:assert/strict')
const { clickSidebarSection, checkRendererNavigation } = require('../packaged/lib/renderer-navigation')
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
