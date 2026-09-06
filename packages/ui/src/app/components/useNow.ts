import { useEffect, useState } from "react";

/**
 * The current time in epoch milliseconds, re-read every `intervalMs` for as long
 * as `enabled` — the clock a live figure (an elapsed duration, a countdown) is
 * measured against.
 *
 * One clock, read once per surface and handed down, rather than a timer inside
 * every cell that shows a live figure: a table of in-flight runs would otherwise
 * own a `setInterval` per row, each firing on its own phase, so two rows started
 * in the same second could tick a second apart and the log would never agree with
 * itself. Sharing the value also means one re-render per tick instead of one per
 * row.
 *
 * `enabled` is the whole point of the flag: when nothing on the surface is live
 * there is no interval at all, so a run log of finished rows costs exactly what it
 * did before the ticker existed. Re-enabling re-reads the clock immediately rather
 * than waiting out the first interval, so a value that went live after a spell
 * with nothing to tick is not stale for its first second.
 */
export function useNow(enabled: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const handle = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(handle);
  }, [enabled, intervalMs]);
  return now;
}
