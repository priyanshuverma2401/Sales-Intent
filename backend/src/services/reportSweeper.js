const Report = require('../models/Report');

/**
 * Recovers reports orphaned mid-generation.
 *
 * reportService.start() returns the HTTP response immediately and finishes the
 * ~60s pipeline in the background via setImmediate. That work lives only in the
 * memory of one instance, so anything that ends the process mid-flight — a
 * Render deploy, a free-tier spin-down, an OOM, a crash — loses it. The Report
 * document is left at status:'pending' forever, and the UI spins on it with
 * nothing to ever resolve it.
 *
 * This sweeper closes that hole without changing how generation works: any
 * report still 'pending' long after the pipeline could plausibly have finished
 * is marked 'failed' with a message telling the user to run it again.
 *
 * The threshold must stay comfortably above the slowest real run, or the sweep
 * would kill reports that are still legitimately working.
 */

// A full run is ~60s. 15 minutes leaves a wide margin for a slow AI provider,
// a retry after a rate-limit cooldown, or a cold start under load.
const STALE_AFTER_MS = Number(process.env.REPORT_STALE_AFTER_MS) || 15 * 60 * 1000;
const SWEEP_EVERY_MS = Number(process.env.REPORT_SWEEP_INTERVAL_MS) || 5 * 60 * 1000;

const STALE_MESSAGE =
  'Generation was interrupted before it finished — most likely the server restarted or was redeployed. Run the report again.';

let timer = null;

/** Marks every report that has been 'pending' longer than the threshold as failed. */
async function sweep({ quiet = false } = {}) {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);

  try {
    const result = await Report.updateMany(
      { status: 'pending', generatedAt: { $lt: cutoff } },
      {
        $set: {
          status: 'failed',
          error: STALE_MESSAGE,
          progress: { step: 'Interrupted', percent: 100 },
        },
      }
    );

    const count = result.modifiedCount || 0;

    if (count > 0) {
      console.warn(`🧹 Recovered ${count} report(s) left stuck mid-generation.`);
    } else if (!quiet) {
      console.log('🧹 Report sweep: nothing stuck.');
    }

    return count;
  } catch (error) {
    // Never let a sweep failure take the server down — it is housekeeping.
    console.error('❌ Report sweep failed:', error.message);
    return 0;
  }
}

/**
 * Runs one sweep at boot (to clear anything the previous instance orphaned)
 * and then on an interval (for anything this instance orphans while running).
 */
function start() {
  sweep({ quiet: true });

  timer = setInterval(() => sweep({ quiet: true }), SWEEP_EVERY_MS);
  // Do not hold the event loop open on shutdown.
  if (typeof timer.unref === 'function') timer.unref();

  console.log(
    `🧹 Report sweeper active (stale after ${Math.round(STALE_AFTER_MS / 60000)}m, ` +
    `checked every ${Math.round(SWEEP_EVERY_MS / 60000)}m)`
  );
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, sweep, STALE_AFTER_MS };
