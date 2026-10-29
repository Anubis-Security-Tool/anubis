/**
 * Headless machine-host auto-update poller.
 *
 * Runs ONLY inside the SYSTEM AnubisHost service (not the desktop GUI, not the
 * user-context worker, not QA editions). It periodically reuses the pure
 * checkMachineUpdate/installMachineUpdate helpers (same validation the manual
 * GUI updater uses: download-origin pinning, windows_machine_host===1, double
 * sha256 verification, newer-version gate) and, when a newer build is offered,
 * launches the signed installer in --silent mode. No interactive dialog is
 * ever shown on this path; the elevated SYSTEM service runs the installer
 * without UAC, and the installer performs the proven stop/arm/restart cycle.
 *
 * Anti-loop + safety: per-target backoff with a hard failure cap, a single
 * in-flight attempt, and a persisted "launched" marker. If a prior launch is
 * observed to have NOT taken effect (service restarted on the old version and
 * the feed still offers the same target), it is scored as a failure with
 * backoff instead of being relaunched immediately, so a silently failing
 * installer cannot hot-loop. A strict skip-if-current gate ensures a device
 * never reinstalls its own version.
 */
const fs = require('node:fs')
const path = require('node:path')
const { checkMachineUpdate, installMachineUpdate } = require('./machine-client-update')
const {
  prepareWindowsUpdate, discardPreparedWindowsUpdate, launchPreparedWindowsUpdate
} = require('./windows-host-client')

const FIRST_DELAY_MIN = 2 * 60 * 1000 // first check 2-5 min after ready
const FIRST_DELAY_SPAN = 3 * 60 * 1000
const BASE_INTERVAL = 45 * 60 * 1000 // steady cadence 45 min +/- 15 min jitter
const JITTER_SPAN = 30 * 60 * 1000
const BACKOFF_BASE = 15 * 60 * 1000 // per-target backoff: 15 min * 2^(failures-1), capped
const BACKOFF_CAP = 6 * 60 * 60 * 1000
const MAX_FAILURES = 3 // stop retrying the same failing target after this many failures
const STATE_FILE = 'machine-update-state.json'

function eligibleRuntime ({ mode, serviceName, updateEnabled }) {
  return mode === 'system' && serviceName === 'AnubisHost' && updateEnabled === true
}

function sanitizeState (value) {
  const state = { target: null, failureCount: 0, nextEligibleTime: 0, launchedVersion: null }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return state
  if (typeof value.target === 'string' && /^\d+\.\d+\.\d+$/.test(value.target)) state.target = value.target
  if (Number.isInteger(value.failureCount) && value.failureCount >= 0 && value.failureCount <= 1000) {
    state.failureCount = value.failureCount
  }
  if (Number.isFinite(value.nextEligibleTime) && value.nextEligibleTime >= 0) {
    state.nextEligibleTime = value.nextEligibleTime
  }
  if (typeof value.launchedVersion === 'string' && /^\d+\.\d+\.\d+$/.test(value.launchedVersion)) {
    state.launchedVersion = value.launchedVersion
  }
  return state
}

// Score a failed attempt against a target, applying per-target backoff. A new
// target resets the counter; the same target escalates the backoff window.
function recordFailure (state, version, now) {
  const next = version === state.target
    ? { ...state, failureCount: state.failureCount + 1 }
    : { ...state, target: version, failureCount: 1 }
  next.launchedVersion = null
  next.nextEligibleTime = now + Math.min(BACKOFF_CAP, BACKOFF_BASE * 2 ** (next.failureCount - 1))
  return next
}

// Pure eligibility decision, exported for tests: never retry past the failure
// cap, and respect the backoff window for the same failing target. A brand-new
// target is always eligible. (The "already launched but ineffective" case is
// converted to a failure before this gate is consulted.)
function shouldAttempt (state, version, now) {
  if (version !== state.target) return true
  if (state.failureCount >= MAX_FAILURES) return false
  return now >= state.nextEligibleTime
}

function createMachineUpdatePoller (options) {
  const {
    brand,
    currentVersion,
    serviceName,
    helper,
    tempDir,
    dataDir,
    signal,
    log = require('../common/log'),
    now = Date.now,
    random = Math.random,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    check = checkMachineUpdate,
    install = installMachineUpdate,
    prepare = (file, update) => prepareWindowsUpdate(helper, serviceName, file, update),
    discard = file => discardPreparedWindowsUpdate(file, serviceName),
    launch = file => launchPreparedWindowsUpdate(file, { silent: true })
  } = options

  const stateFile = path.join(dataDir, STATE_FILE)
  let timer = null
  let stopped = false
  let busy = false

  const readState = () => {
    try {
      return sanitizeState(JSON.parse(fs.readFileSync(stateFile, 'utf8')))
    } catch {
      return sanitizeState(null)
    }
  }
  const writeState = state => {
    try {
      fs.writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 })
    } catch (error) {
      log.error('machine auto-update state write failed', error.code || 'ERR_STATE_WRITE')
    }
  }

  const schedule = delay => {
    if (stopped) return
    timer = setTimer(() => { cycle() }, delay)
  }
  const nextInterval = () => BASE_INTERVAL + Math.floor((random() - 0.5) * JITTER_SPAN)

  const notify = (() => {
    let lastPhase = null
    return value => {
      if (value.phase && value.phase !== lastPhase) {
        lastPhase = value.phase
        log.debug('machine auto-update phase', value.phase)
      }
    }
  })()

  const cycle = async () => {
    if (stopped || busy) return
    if (signal?.aborted) return
    busy = true
    let reschedule = true
    try {
      const update = await check(brand, currentVersion)
      if (!update.available) {
        log.debug('machine auto-update: already current')
        return
      }
      const state = readState()
      // A newer build is still offered while we previously launched this exact
      // target: the earlier installer did not take effect (crash/rollback). Do
      // not relaunch; score it as a failure and back off (capped), so a broken
      // target cannot hot-loop on every service restart.
      if (state.launchedVersion === update.version) {
        writeState(recordFailure(state, update.version, now()))
        log.error('machine auto-update: previous install did not take effect', update.version)
        return
      }
      if (!shouldAttempt(state, update.version, now())) {
        log.debug('machine auto-update: skipping', update.version)
        return
      }
      // Prod log level is `warn`, so the genuinely notable fleet actions (a
      // device is about to self-replace its binaries) are logged at warn to
      // leave an auditable trace; routine "no update" cycles stay at debug.
      log.warn('machine auto-update: installing', update.version)
      try {
        await install(update, { tempDir, prepare, discard, launch, notify, signal })
      } catch (error) {
        writeState(recordFailure(state, update.version, now()))
        log.error('machine auto-update failed', error.code || 'ERR_HOST_UPDATE_FAILED')
        return
      }
      writeState({ ...readState(), launchedVersion: update.version })
      stopped = true
      reschedule = false
      log.warn('machine auto-update: installer launched', update.version)
    } catch (error) {
      log.error('machine auto-update check failed', error.code || 'ERR_HOST_UPDATE_METADATA')
    } finally {
      busy = false
      if (reschedule && !stopped) schedule(nextInterval())
    }
  }

  return {
    start () {
      if (stopped || timer) return
      // One prod-visible line per process lifetime: confirms on every fleet
      // device (and the canary) that the headless auto-update poller is live.
      log.warn('machine auto-update: poller active', currentVersion)
      schedule(FIRST_DELAY_MIN + Math.floor(random() * FIRST_DELAY_SPAN))
    },
    stop () {
      stopped = true
      if (timer) {
        clearTimer(timer)
        timer = null
      }
    },
    cycle
  }
}

module.exports = {
  createMachineUpdatePoller, eligibleRuntime, shouldAttempt, recordFailure, sanitizeState
}
