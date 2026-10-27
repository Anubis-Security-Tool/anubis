const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const net = require('node:net')
const { spawn, execFileSync } = require('node:child_process')
const { once } = require('node:events')
const { setTimeout: delay } = require('node:timers/promises')
const suite = require('../../../scripts/source-suite')

const root = path.resolve(__dirname, '../../..')
const digest = value => crypto.createHash('sha256').update(value).digest('hex')

function snapshot (directory) {
  const rows = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(directory, entry.name)
    assert(!entry.isSymbolicLink(), 'Sync data must not contain links')
    if (entry.isDirectory()) {
      for (const row of snapshot(file)) rows.push({ ...row, path: entry.name + '/' + row.path })
    } else {
      assert(entry.isFile(), 'Sync data must contain only regular files')
      rows.push({ path: entry.name, sha256: digest(fs.readFileSync(file)) })
    }
  }
  return rows
}

async function assertPortFree (port) {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve)
  })
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}

function groupAlive (pid) {
  try {
    process.kill(-pid, 0)
    return true
  } catch (error) {
    if (error.code === 'ESRCH') return false
    throw error
  }
}

async function waitForGroupExit (pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (groupAlive(pid) && Date.now() < deadline) await delay(100)
  return !groupAlive(pid)
}

async function stopOwnedGroup (child) {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  if (await waitForGroupExit(child.pid, 4000)) return
  process.kill(-child.pid, 'SIGTERM')
  if (await waitForGroupExit(child.pid, 3000)) return
  process.kill(-child.pid, 'SIGKILL')
  assert(await waitForGroupExit(child.pid, 3000), 'Owned source-suite process group survived cleanup')
  throw new Error('Source suite required forced SIGKILL cleanup')
}

async function waitForWeb (child, url) {
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, 'Source suite exited before Web readiness')
    assert.equal(child.signalCode, null, 'Source suite was signalled before Web readiness')
    let response
    try {
      response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(1000) })
    } catch (error) {
      if (error.name !== 'TimeoutError' && error.cause?.code !== 'ECONNREFUSED') throw error
      await delay(200)
      continue
    }
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type'), /text\/html/)
    assert.match(await response.text(), /<!doctype html/i)
    return
  }
  throw new Error('Standalone Web did not become ready')
}

function findOwnedSyncChild (runnerPid, workspace) {
  const expected = path.join(workspace, 'components/sync-server-node/server.js')
  const children = fs.readFileSync(`/proc/${runnerPid}/task/${runnerPid}/children`, 'utf8').trim()
  for (const value of children.split(/\s+/).filter(Boolean)) {
    const pid = Number(value)
    assert(Number.isSafeInteger(pid) && pid > 1)
    const args = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0')
    if (args[0] !== process.execPath || args[1] !== expected) continue
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8')
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    assert.equal(Number(fields[1]), runnerPid, 'Sync process is not our direct child')
    assert.equal(Number(fields[2]), runnerPid, 'Sync process left our owned group')
    assert.equal(Number(fields[3]), runnerPid, 'Sync process left our owned session')
    return pid
  }
  throw new Error('Unable to identify the exact owned local Sync child')
}

async function main () {
  assert.equal(process.platform, 'linux', 'Fresh source smoke requires an isolated Linux runner')
  const workspace = process.env.ANUBIS_SOURCE_SUITE_SMOKE_WORKSPACE
  const receiptFile = process.env.ANUBIS_SOURCE_SUITE_SMOKE_RECEIPT
  assert(workspace && path.isAbsolute(workspace) && receiptFile && path.isAbsolute(receiptFile))
  assert(!fs.existsSync(receiptFile), 'Refusing to overwrite an existing smoke receipt')
  const configFile = path.join(workspace, 'config/local-sync.json')
  const configHash = digest(fs.readFileSync(configFile))
  const config = JSON.parse(fs.readFileSync(configFile))
  suite.validateLocalSyncConfig(config)
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version
  const yarnCli = require.resolve('yarn/bin/yarn.js')
  assert(fs.realpathSync(yarnCli).startsWith(fs.realpathSync(path.join(root, 'node_modules', 'yarn')) + path.sep), 'Yarn must resolve inside the fresh checkout')
  const localYarnVersion = execFileSync(process.execPath, [yarnCli, '--version'], {
    cwd: root, encoding: 'utf8', timeout: 5000
  }).trim()
  assert.equal(localYarnVersion, '1.22.22')
  const desktopFiles = ['app.js', ...[
    `js/basic-${version}.js`, `js/electerm-${version}.js`,
    `js/worker-${version}.js`, `css/style-${version}.css`
  ].map(file => path.join('assets', file))]
  const desktop = desktopFiles.map(file => {
    const bytes = fs.readFileSync(path.join(root, 'work/app', file))
    assert(bytes.length > 0, 'Desktop source build output is empty')
    return { path: file, bytes: bytes.length, sha256: digest(bytes) }
  })
  await assertPortFree(config.port)
  await assertPortFree(18745)
  const password = crypto.randomBytes(32).toString('hex')
  const secret = crypto.randomBytes(32).toString('hex')
  if (process.env.GITHUB_ACTIONS === 'true') {
    for (const value of [password, secret, config.jwtSecret, config.userId]) console.log(`::add-mask::${value}`)
  }
  const spawnSuite = () => spawn(process.execPath, [
    'scripts/source-suite.js', 'run', '--web-only', '--workspace', workspace
  ], {
    cwd: root,
    detached: true,
    stdio: 'inherit',
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: '18745',
      ENABLE_AUTH: '1',
      SERVER_PASS: password,
      SERVER_SECRET: secret,
      ANUBIS_MANAGED_ACCESS: '0',
      ANUBIS_MANAGED_URL: ''
    }
  })
  const child = spawnSuite()
  let spawnError
  child.once('error', error => { spawnError = error })
  const interrupt = () => child.kill('SIGTERM')
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', interrupt)
  try {
    if (spawnError) throw spawnError
    await suite.waitForLocalSync(child, config, { timeoutMs: 30000 })
    await waitForWeb(child, 'http://127.0.0.1:18745/')
    const unauthorized = await fetch('http://127.0.0.1:18745/api/get-constants', { redirect: 'error', signal: AbortSignal.timeout(5000) })
    assert.equal(unauthorized.status, 401)
    await unauthorized.body?.cancel()
    const login = await fetch('http://127.0.0.1:18745/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
      redirect: 'error',
      signal: AbortSignal.timeout(5000)
    })
    assert.equal(login.status, 200)
    const token = await login.text()
    assert.equal(token.split('.').length, 3, 'Web login did not return a JWT')
    const authenticated = await fetch('http://127.0.0.1:18745/api/get-constants', {
      headers: { token }, redirect: 'error', signal: AbortSignal.timeout(5000)
    })
    assert.equal(authenticated.status, 200)
    await authenticated.body?.cancel()
    const data = path.join(workspace, 'data/sync')
    const before = snapshot(data)
    await suite.waitForLocalSync(child, config)
    const denied = await fetch(`http://${config.host}:${config.port}/api/sync`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000)
    })
    assert.equal(denied.status, 401)
    await denied.body?.cancel()
    assert.deepEqual(snapshot(data), before, 'Sync readiness requests modified stored data')
  } finally {
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', interrupt)
    if (child.pid) await stopOwnedGroup(child)
  }
  assert.equal(child.exitCode, 0, 'Source-suite CLI did not stop gracefully')
  await assertPortFree(config.port)
  await assertPortFree(18745)
  const failed = spawnSuite()
  const interruptFailure = () => failed.kill('SIGTERM')
  process.once('SIGINT', interruptFailure)
  process.once('SIGTERM', interruptFailure)
  try {
    await suite.waitForLocalSync(failed, config, { timeoutMs: 30000 })
    await waitForWeb(failed, 'http://127.0.0.1:18745/')
    const syncPid = findOwnedSyncChild(failed.pid, workspace)
    const exit = once(failed, 'exit', { signal: AbortSignal.timeout(10000) })
    process.kill(syncPid, 'SIGTERM')
    const [code, signal] = await exit
    assert.equal(signal, null, 'Source-suite runner was externally terminated')
    assert(Number.isInteger(code) && code > 0, 'Mandatory Sync failure must fail the CLI')
    assert(!groupAlive(failed.pid), 'Mandatory Sync failure left owned client processes running')
  } finally {
    process.removeListener('SIGINT', interruptFailure)
    process.removeListener('SIGTERM', interruptFailure)
    if (failed.pid) await stopOwnedGroup(failed)
  }
  await assertPortFree(config.port)
  await assertPortFree(18745)
  assert.equal(digest(fs.readFileSync(configFile)), configHash, 'Runtime changed the retained local Sync configuration')
  const receipt = {
    completed: true,
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    version,
    actualSourceSuiteInstall: true,
    localYarnVersion,
    desktopBuild: desktop,
    desktopGuiExecuted: false,
    webHtmlReady: true,
    webAuthenticationVerified: true,
    authenticatedNonWritingSyncReady: true,
    unauthenticatedSyncRejected: true,
    ownedProcessGroupStopped: true,
    mandatorySyncFailureStopsClientsAndFailsCli: true,
    retainedLocalSyncConfigUnchanged: true,
    loopbackPortsReleased: true,
    managedEnrollmentEnabled: false,
    productionNetworkTargetsTested: false,
    publisherSecretsUsed: false
  }
  fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify(receipt, null, 2))
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
