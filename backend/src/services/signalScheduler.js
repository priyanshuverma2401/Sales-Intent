const signalService = require('./signalService');

/**
 * The nightly signal refresh.
 *
 * Reports are generated on demand - a rep presses Regenerate and gets a
 * document written against the profile as it stands. Signals are the opposite:
 * a feed that only updates when somebody clicks is not a feed, so this runs on
 * its own and new signals are simply there in the morning.
 *
 * In-process rather than an external cron, which is the trade the deployment
 * makes: no extra service to stand up, but a sweep only fires while an instance
 * is awake. On a host that idles the process to sleep a day can be missed
 * entirely, so the sweep is also run shortly after boot - whenever the instance
 * next wakes it catches up on anything the sleep cost it.
 */

const EVERY_MS = Number(process.env.SIGNAL_SWEEP_INTERVAL_MS) || 24 * 60 * 60 * 1000;

// Long enough after boot that a deploy's own start-up work is done first
const BOOT_DELAY_MS = Number(process.env.SIGNAL_SWEEP_BOOT_DELAY_MS) || 2 * 60 * 1000;

// A sweep is minutes of network work; two running at once would double every
// upstream's request rate for no benefit
const MIN_GAP_MS = Number(process.env.SIGNAL_SWEEP_MIN_GAP_MS) || 20 * 60 * 60 * 1000;

// 0 means every account on file
const BATCH = Number(process.env.SIGNAL_SWEEP_BATCH) || 0;

let timer = null;
let bootTimer = null;
let running = false;
let lastRunAt = 0;

async function run({ force = false } = {}) {
  if (running) {
    console.log('📡 Signal sweep already in progress — skipped.');
    return null;
  }

  // Catching up after a sleep must not mean sweeping twice in an hour because
  // the process happened to restart
  if (!force && lastRunAt && Date.now() - lastRunAt < MIN_GAP_MS) {
    return null;
  }

  running = true;
  try {
    const result = await signalService.sweep({ limit: BATCH });
    lastRunAt = Date.now();
    return result;
  } catch (error) {
    // Housekeeping must never take the server down with it
    console.error('❌ Signal sweep failed:', error.message);
    return null;
  } finally {
    running = false;
  }
}

function start() {
  bootTimer = setTimeout(() => run(), BOOT_DELAY_MS);
  timer = setInterval(() => run(), EVERY_MS);

  // Neither should hold the event loop open on shutdown
  if (typeof timer.unref === 'function') timer.unref();
  if (typeof bootTimer.unref === 'function') bootTimer.unref();

  console.log(
    `📡 Signal sweeper active (every ${Math.round(EVERY_MS / 3600000)}h, ` +
    `first run in ${Math.round(BOOT_DELAY_MS / 60000)}m` +
    `${BATCH ? `, ${BATCH} accounts per run` : ''})`
  );
}

function stop() {
  if (timer) clearInterval(timer);
  if (bootTimer) clearTimeout(bootTimer);
  timer = null;
  bootTimer = null;
}

module.exports = { start, stop, run, EVERY_MS };
