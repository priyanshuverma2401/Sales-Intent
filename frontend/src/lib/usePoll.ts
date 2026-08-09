import { useEffect, useRef } from 'react';

/**
 * Re-runs `tick` while `active`, waiting a little longer after each attempt.
 *
 * A fixed short interval is the wrong shape for work that usually takes about
 * a minute but occasionally takes several. The first seconds are worth
 * checking often, because most jobs land there; the tenth minute is not, and
 * hammering the API at the same rate for it achieves nothing except load. Each
 * wait grows by `factor` up to `maxMs`, so a quick job still feels immediate
 * and a slow one quietly settles down.
 *
 * `tick` is held in a ref rather than being a dependency: the callbacks passed
 * in are usually rebuilt on every render, and depending on them would restart
 * the schedule - and reset the backoff to its shortest wait - continuously.
 */
export function usePoll(
  tick: () => void,
  {
    active,
    initialMs = 3000,
    maxMs = 20000,
    factor = 1.6,
  }: { active: boolean; initialMs?: number; maxMs?: number; factor?: number }
) {
  const saved = useRef(tick);

  useEffect(() => {
    saved.current = tick;
  }, [tick]);

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    let wait = initialMs;
    let timer: ReturnType<typeof setTimeout>;

    const schedule = () => {
      timer = setTimeout(() => {
        if (cancelled) return;
        saved.current();
        wait = Math.min(maxMs, Math.round(wait * factor));
        schedule();
      }, wait);
    };

    schedule();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, initialMs, maxMs, factor]);
}
