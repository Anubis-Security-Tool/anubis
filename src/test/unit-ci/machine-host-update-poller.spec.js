const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  createMachineUpdatePoller, eligibleRuntime, shouldAttempt, recordFailure, sanitizeState
} = require('../../app/lib/machine-host-update-poller')

const MIN = 60 * 1000
const silentLog = { info () {}, debug () {}, warn () {}, error () {} }
const stateOf = dir => JSON.parse(fs.readFileSync(path.join(dir, 'machine-update-state.json'), 'utf8'))
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'anubis-poller-'))

function makePoller (over = {}) {
  const dir = over.dataDir || tempDir()
  const timers = []
  const poller = createMachineUpdatePoller({
    brand: {},
    currentVersion: over.currentVersion || '5.7.9',
    serviceName: 'AnubisHost',
    helper: 'anubis-host.exe',
    tempDir: dir,
    dataDir: dir,
    log: over.log || silentLog,
    now: over.now || (() => 1000),
    random: () => 0.5,
    setTimer: (fn, delay) => { timers.push({ fn, delay }); return timers.length },
    clearTimer: () => {},
    check: over.check || (async () => ({ available: false })),
    install: over.install || (async () => {}),
    prepare: () => {},
    discard: () => {},
    launch: over.launch || (() => 1)
  })
  return { poller, dir, timers }
}

test('start emits a prod-visible startup notice and schedules the first check', () => {
  const warnings = []
  const { poller, timers } = makePoller({
    currentVersion: '5.7.10',
    log: { info () {}, debug () {}, error () {}, warn (...args) { warnings.push(args) } }
  })
  poller.start()
  assert.equal(timers.length, 1) // first check scheduled
  assert.ok(timers[0].delay >= 2 * MIN) // not before the 2-5 min window
  const notice = warnings.find(args => String(args[0]).includes('poller active'))
  assert.ok(notice, 'a warn-level "poller active" notice is logged')
  assert.equal(notice[1], '5.7.10') // carries the running version
})

test('eligibleRuntime admits only the SYSTEM AnubisHost service with updates enabled', () => {
  assert.equal(eligibleRuntime({ mode: 'system', serviceName: 'AnubisHost', updateEnabled: true }), true)
  assert.equal(eligibleRuntime({ mode: 'user-context', serviceName: 'AnubisHost', updateEnabled: true }), false)
  assert.equal(eligibleRuntime({ mode: 'system', serviceName: 'AnubisHost-QA-dev', updateEnabled: true }), false)
  assert.equal(eligibleRuntime({ mode: 'system', serviceName: 'AnubisHost', updateEnabled: false }), false)
})

test('sanitizeState rejects malformed persisted values', () => {
  assert.deepEqual(sanitizeState(null), { target: null, failureCount: 0, nextEligibleTime: 0, launchedVersion: null })
  assert.deepEqual(sanitizeState([1, 2]), { target: null, failureCount: 0, nextEligibleTime: 0, launchedVersion: null })
  assert.deepEqual(
    sanitizeState({ target: 'nope', failureCount: -1, nextEligibleTime: -5, launchedVersion: 'x' }),
    { target: null, failureCount: 0, nextEligibleTime: 0, launchedVersion: null }
  )
  assert.deepEqual(
    sanitizeState({ target: '5.7.10', failureCount: 2, nextEligibleTime: 9, launchedVersion: '5.7.10' }),
    { target: '5.7.10', failureCount: 2, nextEligibleTime: 9, launchedVersion: '5.7.10' }
  )
})

test('shouldAttempt honors new target, backoff window and failure cap', () => {
  assert.equal(shouldAttempt({ target: null, failureCount: 0, nextEligibleTime: 0, launchedVersion: null }, '5.7.10', 0), true)
  assert.equal(shouldAttempt({ target: '5.7.10', failureCount: 1, nextEligibleTime: 5000, launchedVersion: null }, '5.7.10', 4000), false)
  assert.equal(shouldAttempt({ target: '5.7.10', failureCount: 1, nextEligibleTime: 5000, launchedVersion: null }, '5.7.10', 5000), true)
  assert.equal(shouldAttempt({ target: '5.7.10', failureCount: 3, nextEligibleTime: 0, launchedVersion: null }, '5.7.10', 1e12), false)
  // A brand-new, different target always resets eligibility.
  assert.equal(shouldAttempt({ target: '5.7.10', failureCount: 3, nextEligibleTime: 1e15, launchedVersion: null }, '5.7.11', 0), true)
})

test('recordFailure escalates same-target backoff and resets on a new target', () => {
  const first = recordFailure({ target: null, failureCount: 0, nextEligibleTime: 0, launchedVersion: '5.7.10' }, '5.7.10', 1000)
  assert.equal(first.target, '5.7.10')
  assert.equal(first.failureCount, 1)
  assert.equal(first.launchedVersion, null)
  assert.equal(first.nextEligibleTime, 1000 + 15 * MIN)
  const second = recordFailure(first, '5.7.10', 2000)
  assert.equal(second.failureCount, 2)
  assert.equal(second.nextEligibleTime, 2000 + 30 * MIN)
  const reset = recordFailure(second, '5.7.11', 3000)
  assert.equal(reset.target, '5.7.11')
  assert.equal(reset.failureCount, 1)
})

test('cycle does nothing and writes no state when already current (skip-if-current)', async () => {
  let installed = false
  const { poller, dir } = makePoller({
    check: async () => ({ available: false }),
    install: async () => { installed = true }
  })
  await poller.cycle()
  assert.equal(installed, false)
  assert.equal(fs.existsSync(path.join(dir, 'machine-update-state.json')), false)
})

test('cycle installs an available build, marks it launched and stops polling', async () => {
  let opts
  const { poller, dir, timers } = makePoller({
    check: async () => ({ available: true, version: '5.7.10' }),
    install: async (_update, passed) => { opts = passed }
  })
  await poller.cycle()
  assert.equal(stateOf(dir).launchedVersion, '5.7.10')
  assert.equal(timers.length, 0) // no reschedule after a successful launch
  assert.equal(typeof opts.launch, 'function') // silent launch wired through installMachineUpdate
  assert.equal(typeof opts.prepare, 'function')
})

test('cycle records a backoff failure and reschedules when install throws', async () => {
  const { poller, dir, timers } = makePoller({
    now: () => 1000,
    check: async () => ({ available: true, version: '5.7.10' }),
    install: async () => { throw Object.assign(new Error('x'), { code: 'ERR_HOST_UPDATE_DOWNLOAD' }) }
  })
  await poller.cycle()
  const state = stateOf(dir)
  assert.equal(state.target, '5.7.10')
  assert.equal(state.failureCount, 1)
  assert.equal(state.nextEligibleTime, 1000 + 15 * MIN)
  assert.equal(timers.length, 1) // rescheduled for a later retry
})

test('a silently ineffective install is scored as a failure and stops after the cap', async () => {
  const dir = tempDir()
  const check = async () => ({ available: true, version: '5.7.10' }) // feed keeps offering it; we stay on 5.7.9
  let installs = 0
  let clock = 0
  // Each entry simulates one fresh service process (restart), reading the
  // persisted state. Advancing the clock far past any backoff isolates the
  // cap behaviour from the backoff window.
  const runCycle = async () => {
    clock += 48 * 60 * MIN
    const { poller } = makePoller({
      dataDir: dir,
      now: () => clock,
      currentVersion: '5.7.9',
      check,
      install: async () => { installs++ } // "launch" succeeds; file swap silently fails
    })
    await poller.cycle()
  }

  await runCycle() // 1: new target -> install #1, launchedVersion=5.7.10
  assert.equal(installs, 1)
  assert.equal(stateOf(dir).launchedVersion, '5.7.10')

  await runCycle() // 2: restart, still 5.7.9 + offered -> ineffective -> failure #1, no install
  assert.equal(installs, 1)
  assert.equal(stateOf(dir).failureCount, 1)
  assert.equal(stateOf(dir).launchedVersion, null)

  await runCycle() // 3: past backoff -> install #2
  assert.equal(installs, 2)
  await runCycle() // 4: ineffective -> failure #2
  assert.equal(installs, 2)
  assert.equal(stateOf(dir).failureCount, 2)

  await runCycle() // 5: past backoff -> install #3
  assert.equal(installs, 3)
  await runCycle() // 6: ineffective -> failure #3 (hits cap)
  assert.equal(installs, 3)
  assert.equal(stateOf(dir).failureCount, 3)

  await runCycle() // 7: cap reached -> no further install attempts
  assert.equal(installs, 3)

  fs.rmSync(dir, { recursive: true, force: true })
})
