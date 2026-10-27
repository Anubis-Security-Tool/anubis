#!/usr/bin/env node
'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { spawn, spawnSync, execFileSync } = require('node:child_process')
const { assembleWebClient } = require('../src/build/bin/assemble-web-client')

const root = path.resolve(__dirname, '..')
const registry = 'https://npm.anubis.locker/'
const defaultWorkspace = path.join(root, '.anubis-suite')
const defaultComponents = ['web', 'resource', 'managed-access', 'sync-server-node']
const optionalComponents = new Set(['cloudflare-sync', 'http-tunnel', 'rdpjs', 'site'])
const packageSpecs = {
  resource: { name: '@ai-security-tool/resource', version: '2.2.3', scripts: true },
  'managed-access': { name: '@ai-security-tool/managed-access', version: '1.0.4', scripts: false },
  renderer: { name: '@ai-security-tool/electerm-react', scripts: false },
  'browser-assets': { name: '@ai-security-tool/anubis-browser-assets', scripts: false }
}

function parseArgs (argv) {
  const args = [...argv]
  const command = args.shift() || 'install'
  if (command === '--help' || command === '-h') {
    return { command: 'help', workspace: defaultWorkspace, with: [], runMode: 'all' }
  }
  if (!['install', 'run', 'help'].includes(command)) {
    throw new Error(`Unknown command "${command}". Use install, run, or --help.`)
  }
  const options = { command, workspace: defaultWorkspace, with: [], runMode: 'all' }
  while (args.length) {
    const arg = args.shift()
    if (arg === '--help' || arg === '-h') {
      options.command = 'help'
      continue
    }
    if (arg === '--workspace') {
      const value = args.shift()
      if (!value) throw new Error('--workspace requires a path')
      options.workspace = path.resolve(value)
      continue
    }
    if (arg === '--with') {
      const value = args.shift()
      if (!value || !optionalComponents.has(value)) {
        throw new Error(`--with expects one of: ${[...optionalComponents].join(', ')}`)
      }
      if (!options.with.includes(value)) options.with.push(value)
      continue
    }
    if (arg === '--allow-dirty') {
      if (command !== 'install') throw new Error('--allow-dirty is valid only with the install command')
      options.allowDirty = true
      continue
    }
    if (arg === '--desktop-only' || arg === '--web-only') {
      if (command !== 'run') throw new Error(`${arg} is valid only with the run command`)
      const mode = arg === '--desktop-only' ? 'desktop' : 'web'
      if (options.runMode !== 'all') throw new Error('Choose at most one run mode')
      options.runMode = mode
      continue
    }
    throw new Error(`Unknown option "${arg}"`)
  }
  if (command === 'run' && options.with.length) {
    throw new Error('--with is valid only with the install command')
  }
  return options
}

function readPins (file = path.join(__dirname, 'source-suite-pins.json')) {
  let pins
  try {
    pins = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`Cannot read source pin manifest ${file}: ${error.message}`)
  }
  validatePins(pins)
  return pins
}

function validatePins (pins) {
  if (!pins || pins.schemaVersion !== 1 || !pins.components || typeof pins.components !== 'object') {
    throw new Error('Source pin manifest must have schemaVersion 1 and a components object')
  }
  for (const name of defaultComponents) {
    validateComponentPin(name, pins.components[name])
  }
  for (const [name, component] of Object.entries(pins.components)) {
    if (!defaultComponents.includes(name) && !optionalComponents.has(name)) {
      throw new Error(`Unrecognized source component "${name}" in pin manifest`)
    }
    validateComponentPin(name, component)
  }
  for (const name of optionalComponents) {
    if (pins.components[name]) validateComponentPin(name, pins.components[name])
  }
}

function validateComponentPin (name, component) {
  if (!component || typeof component !== 'object') {
    throw new Error(`Missing immutable source pin for required component "${name}"`)
  }
  let url
  try {
    url = new URL(component.repository)
  } catch {
    throw new Error(`Invalid repository URL for "${name}"`)
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== `/Anubis-Security-Tool/${path.posix.basename(url.pathname)}`
  ) {
    throw new Error(`"${name}" must use its canonical Anubis-Security-Tool GitHub HTTPS repository`)
  }
  if (!/^[a-f0-9]{40}$/.test(component.commit || '')) {
    throw new Error(`"${name}" must pin a full lowercase 40-character commit SHA`)
  }
  if (component.packageName && !/^(@ai-security-tool\/[a-z0-9-]+|anubis-web)$/.test(component.packageName)) {
    throw new Error(`Invalid expected package name for "${name}"`)
  }
  if (component.version && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(component.version)) {
    throw new Error(`Invalid expected package version for "${name}"`)
  }
}

function selectedComponents (pins, optional = []) {
  const selected = [...defaultComponents]
  for (const name of optional) {
    if (!optionalComponents.has(name)) throw new Error(`Unsupported optional component "${name}"`)
    if (!pins.components[name]) throw new Error(`No immutable source pin is published for optional component "${name}"`)
    if (!selected.includes(name)) selected.push(name)
  }
  return selected
}

function normalizeRepository (value) {
  const url = new URL(value)
  return `${url.protocol}//${url.hostname.toLowerCase()}${url.pathname.replace(/\.git$/, '').replace(/\/$/, '')}`
}

function runCommand (command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    windowsHide: true
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const detail = options.capture ? result.stderr.trim() : ''
    throw new Error(`${path.basename(command)} exited with code ${result.status}${detail ? `: ${detail}` : ''}`)
  }
  return result
}

function npmCommand (args, { node = process.execPath, env = process.env, platform = process.platform } = {}) {
  if (env.npm_execpath) return { command: node, args: [env.npm_execpath, ...args] }
  const npmCli = path.resolve(path.dirname(node), 'node_modules/npm/bin/npm-cli.js')
  if (platform === 'win32') {
    if (!fs.existsSync(npmCli)) {
      throw new Error('Cannot locate npm-cli.js beside Node.js. Install Node.js with npm and retry.')
    }
    return { command: node, args: [npmCli, ...args] }
  }
  return { command: 'npm', args }
}

function npmRun (args, options = {}) {
  const step = npmCommand(args, options)
  return runCommand(step.command, step.args, options)
}

function ensureDirectory (directory, { privateDirectory = false, platform = process.platform, secureDirectory } = {}) {
  if (fs.existsSync(directory)) {
    const stat = fs.lstatSync(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`Expected a real directory at ${directory}`)
    }
  } else {
    fs.mkdirSync(directory, { recursive: true, mode: privateDirectory ? 0o700 : 0o755 })
  }
  if (privateDirectory) {
    if (secureDirectory) secureDirectory(directory, platform)
    else secureDirectoryDefault(directory, platform)
  }
}

function secureDirectoryDefault (directory, platform) {
  if (platform === 'win32') {
    runCommand('icacls.exe', [directory, '/inheritance:r', '/grant:r', `${currentWindowsAccount()}:(OI)(CI)F`])
  } else {
    fs.chmodSync(directory, 0o700)
  }
}

function securePrivateFileDefault (filename, platform) {
  const stat = fs.lstatSync(filename)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Expected a regular private file at ${filename}`)
  }
  if (platform === 'win32') {
    runCommand('icacls.exe', [filename, '/inheritance:r', '/grant:r', `${currentWindowsAccount()}:F`])
  } else {
    fs.chmodSync(filename, 0o600)
  }
}

function currentWindowsAccount () {
  const account = execFileSync('whoami.exe', [], { encoding: 'utf8', windowsHide: true }).trim()
  if (!account || /[\r\n]/.test(account)) throw new Error('Unable to determine the current Windows account for private suite data')
  return account
}

function ensureWorkspace (workspace, { platform = process.platform, secureDirectory } = {}) {
  const resolved = path.resolve(workspace)
  if (resolved === root || resolved === path.parse(resolved).root) {
    throw new Error('The suite workspace must be a dedicated directory, not the repository or filesystem root')
  }
  if (fs.existsSync(resolved) && fs.lstatSync(resolved).isSymbolicLink()) {
    throw new Error(`The suite workspace cannot be a symbolic link: ${resolved}`)
  }
  ensureDirectory(resolved)
  for (const dir of ['components', 'config', 'data', 'output']) {
    ensureDirectory(path.join(resolved, dir), {
      privateDirectory: dir === 'config' || dir === 'data',
      platform,
      secureDirectory
    })
  }
  return resolved
}

function ensureLocalSyncConfig (workspace, {
  platform = process.platform,
  randomBytes = crypto.randomBytes,
  secureDirectory
} = {}) {
  const configDir = path.join(workspace, 'config')
  ensureDirectory(configDir, { privateDirectory: true, platform, secureDirectory })
  const dataRoot = path.join(workspace, 'data')
  ensureDirectory(dataRoot, { privateDirectory: true, platform, secureDirectory })
  const dataDirs = ['sync', 'desktop', 'web'].map(name => path.join(dataRoot, name))
  for (const dataDir of dataDirs) {
    ensureDirectory(dataDir, { privateDirectory: true, platform, secureDirectory })
  }
  const filename = path.join(configDir, 'local-sync.json')
  if (fs.existsSync(filename)) {
    if (fs.lstatSync(filename).isSymbolicLink() || !fs.lstatSync(filename).isFile()) {
      throw new Error(`Local Sync configuration must be a regular file: ${filename}`)
    }
    let config
    try {
      config = JSON.parse(fs.readFileSync(filename, 'utf8'))
    } catch (error) {
      throw new Error(`Cannot read local Sync configuration ${filename}: ${error.message}`)
    }
    validateLocalSyncConfig(config)
    return config
  }
  if (dataDirs.some(directory => fs.readdirSync(directory).length)) {
    throw new Error('Suite data exists but its private local-sync credentials are missing; restore the matching config instead of generating new credentials')
  }
  const config = {
    host: '127.0.0.1',
    port: 7101,
    userId: randomBytes(16).toString('hex'),
    jwtSecret: randomBytes(32).toString('hex')
  }
  try {
    fs.writeFileSync(filename, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if (error.code === 'EEXIST') {
      return ensureLocalSyncConfig(workspace, { platform, randomBytes, secureDirectory })
    }
    throw error
  }
  return config
}

function validateLocalSyncConfig (config) {
  if (
    !config ||
    config.host !== '127.0.0.1' ||
    config.port !== 7101 ||
    !/^[a-f0-9]{32}$/.test(config.userId || '') ||
    !/^[a-f0-9]{64}$/.test(config.jwtSecret || '')
  ) {
    throw new Error('Local Sync configuration is invalid; refusing to replace or regenerate it')
  }
}

function ensurePinnedCheckout (name, component, workspace, { run = runCommand } = {}) {
  const checkout = path.join(workspace, 'components', name)
  if (!fs.existsSync(checkout)) {
    run('git', ['clone', '--no-checkout', '--', component.repository, checkout])
    run('git', ['-C', checkout, 'checkout', '--detach', component.commit])
  } else {
    const stat = fs.lstatSync(checkout)
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`Existing component path is not a real directory: ${checkout}`)
    }
    const remote = run('git', ['-C', checkout, 'remote', 'get-url', 'origin'], { capture: true }).stdout.trim()
    const head = run('git', ['-C', checkout, 'rev-parse', 'HEAD'], { capture: true }).stdout.trim()
    const dirty = run('git', ['-C', checkout, 'status', '--porcelain', '--untracked-files=all'], { capture: true }).stdout.trim()
    if (normalizeRepository(remote) !== normalizeRepository(component.repository) || head !== component.commit || dirty) {
      throw new Error(`Existing "${name}" checkout does not match the clean immutable pin. Preserve it and use a fresh --workspace path: ${checkout}`)
    }
  }
  return checkout
}

function packPackage (directory, outputDir, { scripts = false, npm = npmRun } = {}) {
  ensureDirectory(outputDir)
  const packDir = path.join(outputDir, `.pack-${crypto.randomBytes(8).toString('hex')}`)
  ensureDirectory(packDir)
  const args = ['pack', '--json', '--pack-destination', packDir]
  if (!scripts) args.splice(1, 0, '--ignore-scripts')
  const result = npm(args, { cwd: directory, capture: true })
  let packed
  try {
    const output = result.stdout.trim()
    const start = output.lastIndexOf('\n[')
    packed = JSON.parse(start < 0 ? output : output.slice(start + 1))
  } catch (error) {
    throw new Error(`npm pack returned invalid metadata in ${directory}: ${error.message}`)
  }
  if (!Array.isArray(packed) || packed.length !== 1 || !packed[0].filename || !packed[0].name || !packed[0].version) {
    throw new Error(`Expected exactly one package tarball from ${directory}`)
  }
  const source = path.join(packDir, packed[0].filename)
  if (!fs.existsSync(source) || !fs.lstatSync(source).isFile()) {
    throw new Error(`npm pack did not create its reported tarball: ${source}`)
  }
  const metadata = packed[0]
  if (metadata.name && metadata.version) {
    const expected = Object.entries(packageSpecs).find(([, spec]) => spec.name === metadata.name)
    if (expected && expected[1].version && metadata.version !== expected[1].version) {
      throw new Error(`${metadata.name} source is ${metadata.version}, expected pinned ${expected[1].version}`)
    }
  }
  const safeName = `${metadata.name.replace(/^@/, '').replace(/\//g, '-')}-${metadata.version}-${crypto.randomBytes(4).toString('hex')}.tgz`
  const target = path.join(outputDir, safeName)
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL)
  fs.rmSync(packDir, { recursive: true, force: true })
  return { path: target, name: metadata.name, version: metadata.version }
}

function validateComponentMetadata (name, checkout, component) {
  const packageJson = path.join(checkout, 'package.json')
  if (!component.packageName && !component.version) return
  if (!fs.existsSync(packageJson)) throw new Error(`Pinned ${name} source is missing package.json`)
  const pkg = JSON.parse(fs.readFileSync(packageJson, 'utf8'))
  if (component.packageName && pkg.name !== component.packageName) {
    throw new Error(`${name} source package name mismatch: expected ${component.packageName}, received ${pkg.name}`)
  }
  if (component.version && pkg.version !== component.version) {
    throw new Error(`${name} source package version mismatch: expected ${component.version}, received ${pkg.version}`)
  }
}

function assertInstalledPackage (rootDir, name, version) {
  const packageJson = path.join(rootDir, 'node_modules', ...name.split('/'), 'package.json')
  if (!fs.existsSync(packageJson)) throw new Error(`Required local package is not installed: ${name}`)
  const pkg = JSON.parse(fs.readFileSync(packageJson, 'utf8'))
  if (pkg.name !== name || pkg.version !== version) {
    throw new Error(`Installed package mismatch for ${name}: expected ${version}, received ${pkg.version}`)
  }
}

function ensureRequiredScript (packageJson, script) {
  const pkg = JSON.parse(fs.readFileSync(packageJson, 'utf8'))
  if (!pkg.scripts?.[script]) throw new Error(`Required npm script "${script}" is missing from ${packageJson}`)
}

function assertAppDependencyVersions (rootDir, packages) {
  const packageJson = path.join(rootDir, 'package.json')
  for (const pkg of packages) {
    assertPackageVersion(pkg, packageJson, pkg.name, 'Desktop')
  }
}

function assertWebDependencyVersions (webDir, packages) {
  const packageJson = path.join(webDir, 'package.json')
  for (const pkg of packages) {
    assertPackageVersion(pkg, packageJson, pkg.name, 'Web')
  }
}

function packMetadata (pkg, spec, label) {
  verifyPackageMetadata(pkg, spec.name, spec.version, label)
}

function installOptionalComponent (name, checkout, { npm = npmRun, node = process.execPath } = {}) {
  const packageJson = path.join(checkout, 'package.json')
  if (!fs.existsSync(packageJson)) {
    throw new Error(`Selected optional component "${name}" has no package.json: ${packageJson}`)
  }
  const pkg = JSON.parse(fs.readFileSync(packageJson, 'utf8'))
  const lockFile = path.join(checkout, 'package-lock.json')
  if (fs.existsSync(lockFile)) {
    npm(['ci', '--legacy-peer-deps', '--no-audit', '--no-fund', `--registry=${registry}`], { cwd: checkout })
  } else if (name !== 'site' || ['dependencies', 'devDependencies', 'optionalDependencies'].some(key => Object.keys(pkg[key] || {}).length)) {
    throw new Error(`Selected optional component "${name}" has no package-lock.json; refusing an unpinned dependency install`)
  }
  if (name === 'cloudflare-sync') {
    npm(['test'], { cwd: checkout })
  } else if (name === 'site') {
    if (!pkg.scripts?.test) throw new Error('Selected site source has no test script')
    npm(['test'], { cwd: checkout })
  }
}

async function installSuite (options, {
  pins = readPins(),
  workspace: requestedWorkspace,
  sourceRoot = root,
  node = process.execPath,
  env = process.env,
  platform = process.platform,
  run = runCommand,
  npm = npmRun,
  pack = packPackage,
  assemble = assembleWebClient,
  secureDirectory,
  secureFile = securePrivateFileDefault,
  log = console
} = {}) {
  const selected = selectedComponents(pins, options.with)
  assertCleanRoot(sourceRoot, Boolean(options.allowDirty), run)
  const workspace = ensureWorkspace(requestedWorkspace || options.workspace, { platform, secureDirectory })
  const appCommit = gitHead(sourceRoot, run)
  if (!/^[a-f0-9]{40}$/.test(appCommit)) throw new Error('Unable to determine the exact Desktop source commit')
  const checkouts = {}
  for (const name of selected) {
    checkouts[name] = ensurePinnedCheckout(name, pins.components[name], workspace, { run })
    validateComponentMetadata(name, checkouts[name], pins.components[name])
  }
  ensureDirectory(checkouts.web, { privateDirectory: true, platform, secureDirectory })
  const syncConfig = ensureLocalSyncConfig(workspace, { platform, secureDirectory })
  const output = path.join(workspace, 'output')
  const resourcePkg = pack(checkouts.resource, output, { scripts: true, npm })
  const sdkPkg = pack(checkouts['managed-access'], output, { scripts: false, npm })
  packMetadata(resourcePkg, packageSpecs.resource, 'Resource')
  packMetadata(sdkPkg, packageSpecs['managed-access'], 'Managed-access SDK')
  const rendererDir = path.join(output, `renderer-${appCommit}`)
  if (fs.existsSync(rendererDir)) {
    throw new Error(`Renderer output already exists; preserve it and use a fresh --workspace path: ${rendererDir}`)
  }
  ensureDirectory(rendererDir)
  assemble({
    root: sourceRoot,
    target: rendererDir,
    registry,
    sourceCommit: appCommit
  })
  const rendererPkg = pack(rendererDir, output, { scripts: false, npm })
  const appVersion = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'package.json'), 'utf8')).version
  verifyPackageMetadata(rendererPkg, packageSpecs.renderer.name, appVersion, 'Desktop renderer')
  assertWebDependencyVersions(checkouts.web, [rendererPkg, sdkPkg, resourcePkg])
  npm(['ci', '--legacy-peer-deps', '--no-audit', '--no-fund', `--registry=${registry}`], { cwd: sourceRoot })
  const webInstall = path.join(checkouts.web, 'scripts', 'install-source.js')
  if (!fs.existsSync(webInstall)) {
    throw new Error(`Pinned Web source is missing its verified source installer: ${webInstall}`)
  }
  run(node, [
    webInstall,
    '--standalone',
    '--renderer-package', rendererPkg.path,
    '--sdk-package', sdkPkg.path,
    '--resource-package', resourcePkg.path
  ], {
    cwd: checkouts.web,
    env: { ...env, NPM_REGISTRY_URL: registry },
    stdio: 'inherit'
  })
  secureFile(path.join(checkouts.web, '.env'), platform)
  const webPackageJson = path.join(checkouts.web, 'package.json')
  ensureRequiredScript(webPackageJson, 'stage-browser-assets')
  npm(['run', 'stage-browser-assets', '--', '--build', '--source-commit', appCommit], {
    cwd: checkouts.web,
    env: { ...env, NPM_REGISTRY_URL: registry }
  })
  const webVersion = JSON.parse(fs.readFileSync(webPackageJson, 'utf8')).dependencies['@ai-security-tool/electerm-react']
  const browserAssetsDir = path.join(checkouts.web, 'dist', `browser-assets-package-${webVersion}`)
  if (!fs.existsSync(browserAssetsDir)) {
    throw new Error(`Web build did not produce version-matched browser assets: ${browserAssetsDir}`)
  }
  const browserAssetsPkg = pack(browserAssetsDir, output, { scripts: false, npm })
  verifyPackageMetadata(browserAssetsPkg, packageSpecs['browser-assets'].name, appVersion, 'Web browser assets')
  const appPackages = [resourcePkg, browserAssetsPkg]
  assertAppDependencyVersions(sourceRoot, appPackages)
  npm([
    'install', '--no-save', '--package-lock=false', '--install-links',
    '--legacy-peer-deps', '--no-audit', '--no-fund', `--registry=${registry}`,
    resourcePkg.path, browserAssetsPkg.path
  ], { cwd: sourceRoot })
  for (const pkg of appPackages) assertInstalledPackage(sourceRoot, pkg.name, pkg.version)
  run(node, ['--test', 'test.js'], { cwd: checkouts['sync-server-node'], stdio: 'inherit' })
  npm(['run', 'b'], { cwd: sourceRoot })
  for (const name of selected.filter(name => optionalComponents.has(name))) {
    installOptionalComponent(name, checkouts[name], { npm, node })
  }
  const desktopBuild = path.join(sourceRoot, 'work', 'app', 'app.js')
  const webManifest = path.join(checkouts.web, 'dist', 'assets', 'views', 'asset-manifest.json')
  if (!fs.existsSync(desktopBuild) || !fs.existsSync(webManifest)) {
    throw new Error('Source build completed without the required Desktop and Web runtime artifacts')
  }
  log.info(`[anubis] Source suite built. Local workspace: ${workspace}`)
  log.info('[anubis] Run with: node scripts/source-suite.js run')
  log.info('[anubis] No public service was deployed; no installer or release was created.')
  return { workspace, appCommit, checkouts, resourcePkg, sdkPkg, rendererPkg, browserAssetsPkg, syncConfig }
}

function expectedPackage (packageJson, packageName) {
  const pkg = JSON.parse(fs.readFileSync(packageJson, 'utf8'))
  return pkg.dependencies?.[packageName] || pkg.devDependencies?.[packageName] || pkg.optionalDependencies?.[packageName]
}

function assertPackageVersion (pkg, packageJson, packageName, label) {
  const expected = expectedPackage(packageJson, packageName)
  if (expected && expected !== pkg.version) {
    throw new Error(`${label} package version ${pkg.version} does not match ${packageName} dependency ${expected}`)
  }
  if (!expected) throw new Error(`${packageName} is not declared by ${packageJson}`)
}

function verifyPackageMetadata (pkg, expectedName, expectedVersion, label) {
  if (pkg.name !== expectedName || pkg.version !== expectedVersion) {
    throw new Error(`${label} package mismatch: expected ${expectedName}@${expectedVersion}, received ${pkg.name}@${pkg.version}`)
  }
}

function sourceEnvironment (env, syncConfig) {
  return {
    ...env,
    ANUBIS_SYNC_URL: `http://${syncConfig.host}:${syncConfig.port}/api/sync`,
    ANUBIS_SYNC_USER: syncConfig.userId,
    ANUBIS_SYNC_JWT_SECRET: syncConfig.jwtSecret
  }
}

function gitHead (directory, run = runCommand) {
  return run('git', ['-C', directory, 'rev-parse', 'HEAD'], { capture: true }).stdout.trim()
}

function assertCleanRoot (directory, allowDirty, run = runCommand) {
  if (allowDirty) return
  const dirty = run('git', ['-C', directory, 'status', '--porcelain', '--untracked-files=all'], { capture: true }).stdout.trim()
  if (dirty) throw new Error('The application checkout has local changes. Commit them or explicitly use --allow-dirty for development.')
}

function installOptions (argv, { nodeVersion = process.versions.node } = {}) {
  const options = parseArgs(argv)
  if (options.command === 'help') return options
  if (Number(nodeVersion.split('.')[0]) < 24) {
    throw new Error(`Node.js 24+ is required; found ${nodeVersion}`)
  }
  return options
}

function makeSyncJwt (secret, userId) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ id: userId, exp: Math.floor(Date.now() / 1000) + 60 })}`
  return `${body}.${crypto.createHmac('sha256', secret).update(body).digest('base64url')}`
}

async function waitForLocalSync (child, config, { timeoutMs = 10000, fetchImpl = globalThis.fetch } = {}) {
  const endpoint = `http://${config.host}:${config.port}/api/sync`
  const deadline = Date.now() + timeoutMs
  let spawnError
  const onError = error => { spawnError = error }
  child.once('error', onError)
  try {
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Local Sync server exited before becoming ready (${child.signalCode || `code ${child.exitCode}`})`)
      }
      try {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { Authorization: `Bearer ${makeSyncJwt(config.jwtSecret, config.userId)}` },
          signal: AbortSignal.timeout(1000)
        })
        const body = await response.text()
        if (response.status === 200 && body === 'test ok') return
        throw new Error(`Local Sync readiness check failed with HTTP ${response.status}`)
      } catch (error) {
        if (error.message.startsWith('Local Sync readiness check failed')) throw error
        if (spawnError) throw spawnError
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error(`Local Sync server exited before becoming ready (${child.signalCode || `code ${child.exitCode}`})`)
        }
        await new Promise(resolve => setTimeout(resolve, 200))
      }
    }
    throw new Error(`Local Sync server did not become ready at ${endpoint}`)
  } finally {
    child.removeListener('error', onError)
  }
}

function stopChild (child, platform) {
  if (!child || child.exitCode !== null || child.signalCode !== null || !child.pid) return
  if (platform === 'win32') {
    const result = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    if (result.error || result.status !== 0) child.kill()
  } else {
    child.kill('SIGTERM')
  }
}

async function runSuite (options, {
  pins = readPins(),
  workspace: requestedWorkspace,
  sourceRoot = root,
  platform = process.platform,
  env = process.env,
  run = runCommand,
  spawnProcess = spawn,
  secureDirectory,
  waitForSync = waitForLocalSync,
  log = console
} = {}) {
  const workspace = ensureWorkspace(requestedWorkspace || options.workspace, { platform, secureDirectory })
  const components = selectedComponents(pins)
  const paths = Object.fromEntries(components.map(name => [name, path.join(workspace, 'components', name)]))
  for (const name of components) {
    ensurePinnedCheckout(name, pins.components[name], workspace, { run })
  }
  const syncConfig = ensureLocalSyncConfig(workspace, { platform, secureDirectory })
  const syncUrl = `http://${syncConfig.host}:${syncConfig.port}/api/sync`
  const children = []
  let interrupted = false
  const interrupt = () => {
    interrupted = true
    for (const child of children) stopChild(child, platform)
  }
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', interrupt)
  try {
    const sync = spawnProcess(process.execPath, [path.join(paths['sync-server-node'], 'server.js')], {
      cwd: paths['sync-server-node'],
      env: {
        ...env,
        HOST: syncConfig.host,
        PORT: String(syncConfig.port),
        JWT_SECRET: syncConfig.jwtSecret,
        JWT_USERS: syncConfig.userId,
        DATA_DIR: path.join(workspace, 'data', 'sync')
      },
      stdio: 'inherit',
      windowsHide: true
    })
    children.push(sync)
    await waitForSync(sync, syncConfig)
    const desktopData = path.join(workspace, 'data', 'desktop')
    const webData = path.join(workspace, 'data', 'web')
    ensureDirectory(desktopData, { privateDirectory: true, platform, secureDirectory })
    ensureDirectory(webData, { privateDirectory: true, platform, secureDirectory })
    const clientEnv = {
      ...env,
      DATA_PATH: desktopData,
      ANUBIS_USER_DATA_DIR: desktopData,
      ANUBIS_ADMIN_CUSTOM_SYNC_API: syncUrl,
      ANUBIS_ADMIN_CUSTOM_SYNC_SECRET: syncConfig.jwtSecret,
      ANUBIS_ADMIN_CUSTOM_SYNC_USER: syncConfig.userId
    }
    const webEnv = {
      ...sourceEnvironment(env, syncConfig),
      DB_PATH: webData,
      DATA_PATH: webData,
      ANUBIS_WEB_HOME: paths.web,
      ANUBIS_MANAGED_ACCESS: '0',
      ANUBIS_MANAGED_URL: ''
    }
    const clients = []
    if (options.runMode !== 'web') {
      if (!fs.existsSync(path.join(sourceRoot, 'work', 'app', 'app.js'))) {
        throw new Error('Desktop source output is missing; run the install command first')
      }
      const electron = require(path.join(sourceRoot, 'node_modules', 'electron'))
      if (typeof electron !== 'string' || !fs.existsSync(electron)) {
        throw new Error('Desktop Electron is not installed; run the install command first')
      }
      const child = spawnProcess(electron, [path.join(sourceRoot, 'work', 'app', 'app.js')], {
        cwd: sourceRoot,
        env: clientEnv,
        stdio: 'inherit',
        windowsHide: true
      })
      children.push(child)
      clients.push(child)
    }
    if (options.runMode !== 'desktop') {
      if (!fs.existsSync(path.join(paths.web, 'dist', 'assets', 'views', 'asset-manifest.json'))) {
        throw new Error('Standalone Web source output is missing; run the install command first')
      }
      const child = spawnProcess(process.execPath, [path.join(paths.web, 'scripts', 'start-managed.js')], {
        cwd: paths.web,
        env: webEnv,
        stdio: 'inherit',
        windowsHide: true
      })
      children.push(child)
      clients.push(child)
    }
    if (!clients.length) throw new Error('No client process was selected')
    const result = await Promise.race(clients.map(child => new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => resolve({ code, signal }))
    })))
    if (!interrupted && result.code !== 0) {
      throw new Error(`A source client exited with ${result.signal || `code ${result.code}`}`)
    }
  } catch (error) {
    if (!interrupted) throw error
  } finally {
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', interrupt)
    for (const child of children) stopChild(child, platform)
  }
  log.info('[anubis] Source suite stopped.')
}

function help (log = console) {
  log.info('Usage: node scripts/source-suite.js <install|run> [options]')
  log.info('  install [--workspace <path>] [--with cloudflare-sync|http-tunnel|rdpjs|site]')
  log.info('  run [--workspace <path>] [--desktop-only|--web-only]')
  log.info('  --allow-dirty is available only for install-time development source builds.')
}

async function main (argv = process.argv.slice(2)) {
  const options = installOptions(argv)
  if (options.command === 'help') {
    help()
    return
  }
  if (options.command === 'install') {
    await installSuite(options)
  } else {
    await runSuite(options)
  }
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`[anubis] Source suite failed: ${error.message}\n`)
    process.exitCode = 1
  })
}

module.exports = {
  defaultComponents,
  optionalComponents,
  parseArgs,
  validatePins,
  selectedComponents,
  npmCommand,
  ensureDirectory,
  ensureWorkspace,
  ensureLocalSyncConfig,
  validateLocalSyncConfig,
  ensurePinnedCheckout,
  packPackage,
  expectedPackage,
  assertPackageVersion,
  verifyPackageMetadata,
  installOptionalComponent,
  sourceEnvironment,
  gitHead,
  assertCleanRoot,
  makeSyncJwt,
  waitForLocalSync,
  stopChild,
  runSuite,
  installSuite,
  main
}
