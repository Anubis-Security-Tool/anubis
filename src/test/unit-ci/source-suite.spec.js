const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const suite = require('../../../scripts/source-suite')

const commit = 'a'.repeat(40)

function pinsFixture () {
  const slugs = {
    web: 'anubis-web',
    resource: 'anubis-resource',
    'managed-access': 'anubis-managed-access',
    'sync-server-node': 'anubis-sync-server-node'
  }
  const optional = {
    'cloudflare-sync': ['anubis-sync-server-cloudflare', 'anubis-sync-server-cloudflare', '1.0.0'],
    'http-tunnel': ['anubis-http-tunnel', '@ai-security-tool/http-tunnel-server', '0.1.0'],
    rdpjs: ['anubis-rdpjs', '@ai-security-tool/rdpjs', '1.0.0'],
    site: ['anubis-site', '@ai-security-tool/anubis-site', '1.0.0']
  }
  const components = Object.fromEntries(Object.entries(slugs).map(([name, slug]) => [
    name,
    {
      repository: `https://github.com/Anubis-Security-Tool/${slug}`,
      commit,
      ...(name === 'web' ? { packageName: 'anubis-web', version: '5.7.5' } : {}),
      ...(name === 'resource' ? { packageName: '@ai-security-tool/resource', version: '2.2.3' } : {}),
      ...(name === 'managed-access' ? { packageName: '@ai-security-tool/managed-access', version: '1.0.4' } : {}),
      ...(name === 'sync-server-node' ? { packageName: 'anubis-sync-server-node', version: '1.0.0' } : {})
    }
  ]))
  for (const [name, [slug, packageName, version]] of Object.entries(optional)) {
    components[name] = {
      repository: `https://github.com/Anubis-Security-Tool/${slug}`,
      commit,
      packageName,
      version
    }
  }
  return {
    schemaVersion: 1,
    components
  }
}

function writeJson (filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true })
  fs.writeFileSync(filename, JSON.stringify(value, null, 2))
}

describe('source suite bootstrap', () => {
  it('parses only supported commands and explicit optional components', () => {
    assert.equal(suite.parseArgs(['install', '--with', 'cloudflare-sync']).with[0], 'cloudflare-sync')
    assert.equal(suite.parseArgs(['run', '--web-only']).runMode, 'web')
    assert.throws(() => suite.parseArgs(['run', '--with', 'http-tunnel']), /valid only with the install command/)
    assert.throws(() => suite.parseArgs(['install', '--with', 'release-api-go']), /expects one of/)
  })

  it('requires canonical repositories and immutable full commit pins', () => {
    const pins = pinsFixture()
    assert.doesNotThrow(() => suite.validatePins(pins))
    pins.components.web.commit = 'main'
    assert.throws(() => suite.validatePins(pins), /full lowercase 40-character commit SHA/)
    pins.components.web.commit = commit
    pins.components.web.repository = 'https://github.com/another-owner/anubis-web'
    assert.throws(() => suite.validatePins(pins), /canonical Anubis-Security-Tool/)
  })

  it('tests dependency-free site source without installing dependencies', () => {
    const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'anubis-site-'))
    const calls = []
    const npm = (args, options) => calls.push({ args, options })
    const packageJson = path.join(checkout, 'package.json')
    try {
      writeJson(packageJson, {
        name: '@ai-security-tool/anubis-site',
        version: '1.0.0',
        scripts: { test: 'node test/test.js' }
      })
      suite.installOptionalComponent('site', checkout, { npm })
      assert.deepEqual(calls.map(call => call.args), [['test']])

      writeJson(packageJson, {
        name: '@ai-security-tool/anubis-site',
        version: '1.0.0',
        dependencies: { example: '1.0.0' },
        scripts: { test: 'node test/test.js' }
      })
      assert.throws(() => suite.installOptionalComponent('site', checkout, { npm }), /no package-lock\.json/)
      writeJson(packageJson, {
        name: '@ai-security-tool/anubis-site',
        version: '1.0.0'
      })
      assert.throws(() => suite.installOptionalComponent('site', checkout, { npm }), /no test script/)
    } finally {
      fs.rmSync(checkout, { recursive: true, force: true })
    }
  })

  it('creates local sync credentials once and refuses to replace credentials when data remains', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'anubis-suite-sync-'))
    const secureDirectories = []
    try {
      const options = {
        platform: 'linux',
        secureDirectory: directory => secureDirectories.push(directory),
        randomBytes: size => Buffer.alloc(size, size)
      }
      const first = suite.ensureLocalSyncConfig(workspace, options)
      assert.equal(first.host, '127.0.0.1')
      assert.equal(first.port, 7101)
      assert.equal(first.userId.length, 32)
      assert.equal(first.jwtSecret.length, 64)
      assert.deepEqual(suite.ensureLocalSyncConfig(workspace, {
        ...options,
        randomBytes: () => { throw new Error('credentials must not be regenerated') }
      }), first)
      const dataDir = path.join(workspace, 'data', 'sync')
      fs.writeFileSync(path.join(dataDir, 'existing.json'), '{}')
      fs.unlinkSync(path.join(workspace, 'config', 'local-sync.json'))
      assert.throws(() => suite.ensureLocalSyncConfig(workspace, options), /Suite data exists but its private local-sync credentials are missing/)
      fs.unlinkSync(path.join(dataDir, 'existing.json'))
      fs.writeFileSync(path.join(workspace, 'data', 'desktop', 'profile.json'), '{}')
      assert.throws(() => suite.ensureLocalSyncConfig(workspace, options), /Suite data exists but its private local-sync credentials are missing/)
      fs.unlinkSync(path.join(workspace, 'data', 'desktop', 'profile.json'))
      fs.writeFileSync(path.join(workspace, 'data', 'web', 'profile.json'), '{}')
      assert.throws(() => suite.ensureLocalSyncConfig(workspace, options), /Suite data exists but its private local-sync credentials are missing/)
      assert.ok(secureDirectories.length >= 2)
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('authenticates the non-writing local sync readiness check', async () => {
    const config = { host: '127.0.0.1', port: 7101, userId: 'b'.repeat(32), jwtSecret: 'c'.repeat(64) }
    const child = new EventEmitter()
    child.exitCode = null
    child.signalCode = null
    let request
    await suite.waitForLocalSync(child, config, {
      fetchImpl: async (url, options) => {
        request = { url, options }
        return { status: 200, text: async () => 'test ok' }
      }
    })
    assert.equal(request.url, 'http://127.0.0.1:7101/api/sync')
    assert.equal(request.options.method, 'POST')
    const token = request.options.headers.Authorization.slice('Bearer '.length)
    const [header, payload, signature] = token.split('.')
    const signingInput = `${header}.${payload}`
    const expected = crypto.createHmac('sha256', config.jwtSecret).update(signingInput).digest('base64url')
    assert.equal(signature, expected)
    assert.equal(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).id, config.userId)
    await assert.rejects(suite.waitForLocalSync(child, config, {
      fetchImpl: async () => ({ status: 401, text: async () => 'Unauthorized' })
    }), /HTTP 401/)
  })

  it('builds Desktop, standalone Web, and Node Sync from one pinned source suite', async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'anubis-suite-install-'))
    const sourceRoot = path.join(temp, 'source')
    const workspace = path.join(temp, 'suite')
    const appCommit = 'b'.repeat(40)
    const calls = { run: [], npm: [], secureFile: [] }
    fs.mkdirSync(sourceRoot)
    writeJson(path.join(sourceRoot, 'package.json'), {
      version: '5.7.5',
      dependencies: { '@ai-security-tool/anubis-browser-assets': '5.7.5' },
      devDependencies: { '@ai-security-tool/resource': '2.2.3' }
    })

    const packageData = {
      'anubis-web': {
        name: 'anubis-web',
        version: '5.7.5',
        devDependencies: {
          '@ai-security-tool/electerm-react': '5.7.5',
          '@ai-security-tool/managed-access': '1.0.4',
          '@ai-security-tool/resource': '2.2.3'
        },
        scripts: { 'stage-browser-assets': 'node build/bin/browser-assets.js' }
      },
      'anubis-resource': { name: '@ai-security-tool/resource', version: '2.2.3' },
      'anubis-managed-access': { name: '@ai-security-tool/managed-access', version: '1.0.4' },
      'anubis-sync-server-node': { name: 'anubis-sync-server-node', version: '1.0.0' }
    }

    const run = (command, args, options = {}) => {
      calls.run.push({ command, args, options })
      if (command === 'git' && args[0] === 'clone') {
        const checkout = args[args.length - 1]
        const slug = args[args.length - 2].split('/').pop()
        fs.mkdirSync(checkout, { recursive: true })
        writeJson(path.join(checkout, 'package.json'), packageData[slug])
        if (slug === 'anubis-web') {
          fs.mkdirSync(path.join(checkout, 'scripts'), { recursive: true })
          fs.writeFileSync(path.join(checkout, 'scripts', 'install-source.js'), '')
        }
      }
      if (command === 'git' && args.includes('status')) return { stdout: '' }
      if (command === 'git' && args.includes('rev-parse')) return { stdout: `${appCommit}\n` }
      if (command === process.execPath && args[0]?.endsWith('install-source.js')) {
        fs.writeFileSync(path.join(options.cwd, '.env'), 'SERVER_PASS=local-only\n')
        writeJson(path.join(options.cwd, 'package.json'), {
          ...packageData['anubis-web'],
          dependencies: packageData['anubis-web'].devDependencies
        })
        fs.mkdirSync(path.join(options.cwd, 'dist', 'assets', 'views'), { recursive: true })
        fs.writeFileSync(path.join(options.cwd, 'dist', 'assets', 'views', 'asset-manifest.json'), '{}')
      }
      return { stdout: '' }
    }

    const npm = (args, options = {}) => {
      calls.npm.push({ args, options })
      if (args[0] === 'run' && args[1] === 'stage-browser-assets') {
        const web = options.cwd
        const dir = path.join(web, 'dist', 'browser-assets-package-5.7.5')
        writeJson(path.join(dir, 'package.json'), {
          name: '@ai-security-tool/anubis-browser-assets',
          version: '5.7.5'
        })
      }
      if (args[0] === 'install') {
        writeJson(path.join(sourceRoot, 'node_modules', '@ai-security-tool', 'resource', 'package.json'), {
          name: '@ai-security-tool/resource',
          version: '2.2.3'
        })
        writeJson(path.join(sourceRoot, 'node_modules', '@ai-security-tool', 'anubis-browser-assets', 'package.json'), {
          name: '@ai-security-tool/anubis-browser-assets',
          version: '5.7.5'
        })
      }
      if (args[0] === 'run' && args[1] === 'b') {
        fs.mkdirSync(path.join(sourceRoot, 'work', 'app'), { recursive: true })
        fs.writeFileSync(path.join(sourceRoot, 'work', 'app', 'app.js'), '')
      }
      return { stdout: '' }
    }

    const pack = (directory, output) => {
      const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'))
      return {
        path: path.join(output, `${pkg.name.replace(/^@/, '').replace(/\//g, '-')}-${pkg.version}.tgz`),
        name: pkg.name,
        version: pkg.version
      }
    }

    try {
      const result = await suite.installSuite({
        command: 'install',
        workspace,
        with: [],
        allowDirty: false
      }, {
        pins: pinsFixture(),
        workspace,
        sourceRoot,
        node: process.execPath,
        env: {},
        platform: 'win32',
        run,
        npm,
        pack,
        assemble: ({ target }) => writeJson(path.join(target, 'package.json'), {
          name: '@ai-security-tool/electerm-react',
          version: '5.7.5'
        }),
        secureDirectory: () => {},
        secureFile: filename => calls.secureFile.push(filename),
        log: { info: () => {} }
      })
      assert.equal(result.appCommit, appCommit)
      assert.deepEqual(result.checkouts && Object.keys(result.checkouts), suite.defaultComponents)
      assert.ok(calls.run.some(call => call.command === process.execPath && call.args[0].endsWith('install-source.js') &&
        call.args.includes('--renderer-package') && call.args.includes('--sdk-package') && call.args.includes('--resource-package')))
      assert.ok(calls.npm.some(call => call.args[0] === 'run' && call.args[1] === 'stage-browser-assets'))
      assert.ok(calls.npm.some(call => call.args[0] === 'install' && call.args.includes('--package-lock=false')))
      assert.ok(calls.run.some(call => call.command === process.execPath && call.args[0] === '--test' && call.args[1] === 'test.js'))
      assert.ok(calls.npm.some(call => call.args[0] === 'run' && call.args[1] === 'b'))
      assert.deepEqual(calls.secureFile, [path.join(workspace, 'components', 'web', '.env')])
    } finally {
      fs.rmSync(temp, { recursive: true, force: true })
    }
  })

  it('runs standalone Web and local Node Sync with isolated data and authenticated sync settings', async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'anubis-suite-run-'))
    const sourceRoot = path.join(temp, 'source')
    const workspace = path.join(temp, 'suite')
    const calls = []
    fs.mkdirSync(sourceRoot)

    const run = (command, args) => {
      if (command === 'git' && args[0] === 'clone') {
        const checkout = args[args.length - 1]
        const slug = args[args.length - 2].split('/').pop()
        fs.mkdirSync(checkout, { recursive: true })
        if (slug === 'anubis-web') {
          fs.mkdirSync(path.join(checkout, 'dist', 'assets', 'views'), { recursive: true })
          fs.writeFileSync(path.join(checkout, 'dist', 'assets', 'views', 'asset-manifest.json'), '{}')
          fs.mkdirSync(path.join(checkout, 'scripts'), { recursive: true })
          fs.writeFileSync(path.join(checkout, 'scripts', 'start-managed.js'), '')
        }
        if (slug === 'anubis-sync-server-node') fs.writeFileSync(path.join(checkout, 'server.js'), '')
      }
      return { stdout: '' }
    }

    const spawnProcess = (command, args, options) => {
      const child = new EventEmitter()
      child.exitCode = null
      child.signalCode = null
      child.pid = calls.length + 100
      child.kill = signal => {
        child.signalCode = signal
        return true
      }
      calls.push({ command, args, options, child })
      if (args[0].endsWith('start-managed.js')) {
        process.nextTick(() => {
          child.exitCode = 0
          child.emit('exit', 0, null)
        })
      }
      return child
    }

    try {
      await suite.runSuite({ runMode: 'web', workspace }, {
        pins: pinsFixture(),
        workspace,
        sourceRoot,
        platform: 'linux',
        env: {},
        run,
        spawnProcess,
        secureDirectory: () => {},
        waitForSync: async (_child, config) => {
          assert.equal(config.host, '127.0.0.1')
          assert.equal(config.port, 7101)
        },
        log: { info: () => {} }
      })
      assert.equal(calls.length, 2)
      const sync = calls[0]
      const web = calls[1]
      assert.equal(sync.options.env.HOST, '127.0.0.1')
      assert.equal(sync.options.env.JWT_USERS.length, 32)
      assert.equal(sync.options.env.JWT_SECRET.length, 64)
      assert.equal(sync.options.env.DATA_DIR, path.join(workspace, 'data', 'sync'))
      assert.equal(web.options.env.ANUBIS_MANAGED_ACCESS, '0')
      assert.equal(web.options.env.ANUBIS_SYNC_URL, 'http://127.0.0.1:7101/api/sync')
      assert.equal(web.options.env.ANUBIS_SYNC_USER, sync.options.env.JWT_USERS)
      assert.equal(web.options.env.ANUBIS_SYNC_JWT_SECRET, sync.options.env.JWT_SECRET)
      assert.equal(web.options.env.DB_PATH, path.join(workspace, 'data', 'web'))
      assert.equal(web.options.env.DATA_PATH, path.join(workspace, 'data', 'web'))
      assert.equal(sync.child.signalCode, 'SIGTERM')
      assert.ok(fs.existsSync(path.join(workspace, 'data', 'web')))
    } finally {
      fs.rmSync(temp, { recursive: true, force: true })
    }
  })
})
