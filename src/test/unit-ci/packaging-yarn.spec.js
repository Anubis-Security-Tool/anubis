const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '../../..')
const script = path.join(root, 'src', 'build', 'bin', 'prepare.js')

function prepare (failure) {
  const cwd = path.join(root, 'fixture with spaces')
  const yarn = path.join(cwd, 'node_modules', 'yarn', 'bin', 'yarn.js')
  const calls = []
  const writes = new Map()
  const shellCommands = []
  const events = []
  const fixtures = {
    '../../../package.json': JSON.parse(fs.readFileSync(path.join(root, 'package.json'))),
    os: { platform: () => 'linux' },
    path: require('node:path'),
    child_process: {
      execFileSync (file, args, options) {
        calls.push({ file, args: Array.from(args), options })
        events.push(args[1])
        if (failure) throw failure
        return Buffer.from('controlled yarn lock output\n')
      }
    },
    shelljs: {
      mkdir () {},
      rm (...args) { events.push(args.at(-1)) },
      echo () {},
      cp () {},
      exec (command) {
        shellCommands.push(command)
        events.push('install')
        return { code: 0 }
      }
    },
    fs: { writeFileSync: (file, bytes) => writes.set(file, bytes) },
    './browser-assets': { stageBrowserAssets () {}, verifyStagedBrowserAssets () {} },
    './third-party-notices': {
      captureBuildNotices () { events.push('build notices') },
      captureRuntimeNotices () { events.push('runtime notices') },
      verifyNotices () { events.push('verify notices') }
    },
    './third-party-compliance': {
      stageCompliance () { events.push('stage compliance') },
      verifyCompliance () { events.push('verify compliance') }
    },
    './clean-empty-folders': { main () {} }
  }
  const requireFixture = name => {
    assert(Object.hasOwn(fixtures, name), 'Unexpected package-preparation dependency: ' + name)
    return fixtures[name]
  }
  requireFixture.resolve = name => {
    assert.equal(name, 'yarn/bin/yarn.js')
    return yarn
  }
  vm.runInNewContext(fs.readFileSync(script, 'utf8'), {
    require: requireFixture,
    __dirname: path.dirname(script),
    process: { cwd: () => cwd, execPath: process.execPath, env: {} }
  }, { filename: script })
  return { cwd, yarn, calls, writes, shellCommands, events }
}

test('package preparation declares and genuinely locks exact local Yarn', () => {
  const pack = JSON.parse(fs.readFileSync(path.join(root, 'package.json')))
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json')))
  assert.equal(pack.devDependencies.yarn, '1.22.22')
  assert.equal(lock.packages[''].devDependencies.yarn, '1.22.22')
  assert.equal(lock.packages['node_modules/yarn'].version, '1.22.22')
  assert.equal(lock.packages['node_modules/yarn'].dev, true)
  assert.match(lock.packages['node_modules/yarn'].integrity, /^sha512-/)
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'protocol-tests.yml'), 'utf8')
  assert.doesNotMatch(workflow, /npm install --global yarn/)
})

test('actual preparation uses local Node/Yarn arguments without global Yarn or shell quoting', () => {
  const { cwd, yarn, calls, writes, shellCommands, events } = prepare()
  assert(events.indexOf('build notices') < events.indexOf('work/app/assets/js/*.txt'))
  assert(events.indexOf('runtime notices') > events.indexOf('install'))
  assert(events.indexOf('runtime notices') < events.indexOf('work/app/node_modules/.bin'))
  assert(events.indexOf('verify notices') > events.indexOf('autoclean'))
  assert(events.indexOf('stage compliance') < events.indexOf('install'))
  assert(events.indexOf('verify compliance') > events.indexOf('autoclean'))
  assert.deepEqual(shellCommands, ['npm i --omit=dev --legacy-peer-deps'])
  assert.equal(calls.length, 2)
  assert(calls.every(call => call.file === process.execPath && call.options.cwd === path.join(cwd, 'work', 'app')))
  assert.deepEqual(calls.map(call => call.args), [
    [yarn, 'generate-lock-entry'],
    [yarn, 'autoclean', '--force']
  ])
  assert.equal(calls[0].options.stdio.join(','), 'ignore,pipe,inherit')
  assert.equal(calls[1].options.stdio, 'inherit')
  assert.equal(writes.get(path.join(cwd, 'work', 'app', 'yarn.lock')).toString(), 'controlled yarn lock output\n')
})

test('local Yarn failures fail package preparation rather than falling back globally', () => {
  const error = new Error('Controlled local Yarn failure')
  assert.throws(() => prepare(error), actual => actual === error)
})

test('release requires fresh source smoke parallel to native builds without inheriting publisher secrets', () => {
  const yaml = require('js-yaml')
  const workflows = path.join(root, '.github', 'workflows')
  const release = yaml.load(fs.readFileSync(path.join(workflows, 'release.yml'), 'utf8'))
  const protocol = yaml.load(fs.readFileSync(path.join(workflows, 'protocol-tests.yml'), 'utf8'))
  const gate = release.jobs['protocols-and-source']
  assert.equal(gate.uses, './.github/workflows/protocol-tests.yml')
  assert.equal(gate.with.source_suite_smoke, true)
  assert.equal(gate.secrets, undefined)
  assert.equal(protocol.on.workflow_call.inputs.source_suite_smoke.type, 'boolean')
  assert.match(protocol.jobs['source-suite-smoke'].if, /^\$\{\{\s*inputs\.source_suite_smoke\s*\}\}$/)
  assert(release.jobs.release.needs.includes('protocols-and-source'))
  for (const name of ['protocols-and-source', 'win-nsis', 'win-portable', 'win-tar', 'linux-deb-tar', 'mac-x64', 'mac-arm']) {
    assert.equal(release.jobs[name].needs, 'check')
  }
  assert.doesNotMatch(JSON.stringify(protocol.jobs['source-suite-smoke']), /secrets\./)
  assert.doesNotMatch(JSON.stringify(protocol.jobs['source-suite-smoke'].env), /\$\{\{\s*runner\./)
  assert.equal(release.on.workflow_dispatch.inputs.publish.default, false)
  assert.equal(release.on.workflow_dispatch.inputs.publish.type, 'boolean')
  assert.match(release.jobs.release.if, /workflow_dispatch.*inputs\.publish/)
  assert(release.jobs.release.needs.includes('check'))
  const publish = release.jobs.release.steps.find(step => step.name === 'Create GitHub release and attach assets')
  assert.match(publish.env.TARGET_SHA, /^\$\{\{\s*github\.sha\s*\}\}$/)
  assert.match(publish.env.TAG, /^\$\{\{\s*needs\.check\.outputs\.tag\s*\}\}$/)
  assert.match(publish.run, /git\/refs/)
  assert.match(publish.run, /--verify-tag --target "\$TARGET_SHA"/)
  assert.doesNotMatch(publish.run, /--force|--clobber/)
})
