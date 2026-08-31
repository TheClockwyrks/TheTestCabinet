// instrumentation — watching a posed strait across tens of seconds of game time.
//
// Three points in this group are about a CADENCE the specification measures in
// tens of seconds — the bonus catch's `FISH_INTERVAL`, a bear slot's delay, the
// seeded layout's first catch — and each of them has to be able to say "nothing
// happened at any point in a minute" rather than "nothing had happened by the
// end of one". That is a sweep: run a stretch, read, run the next.
//
// IT RUNS ON THE HARNESS'S COARSE PACE, through {@link Harness.skip}. The same
// ticks run either way — the simulation advances by the whole ticks a frame's
// elapsed time completes, which is what `specs/overview.md` fixes and what
// `instrumentation/deterministic-core` decides — and only the pictures between
// them are skipped, so a minute of game time costs a tenth of the frames. The
// clock is left at one tick a frame when the sweep returns, exactly as `skip`
// leaves it.
//
// Local to this group rather than on the shared harness because it is the long
// WAIT that is peculiar to these points; a check with a frame-by-frame reading
// uses {@link Harness.until}, which the harness already offers.
//
// It asserts nothing and carries no threshold: how long to watch, how often to
// look, and what a miss means are each stated in the check that calls it.

import type { FloeSnapshot, Harness } from "../harness";

/** What a sweep found, and how much game time it had spent when it stopped. */
export interface Watched {
  /** Whether the predicate ever held. */
  hit: boolean;
  /** Seconds of game time spent before the reading that ended the sweep. */
  elapsed: number;
  /** The snapshot the sweep stopped on. */
  snapshot: FloeSnapshot;
}

/**
 * Run up to `seconds` of game time, reading the snapshot every `pollSeconds`,
 * and stop at the first reading `predicate` holds for.
 *
 * The state as it stands is read first, so a sweep whose condition is already
 * true reports it without spending any game time.
 */
export async function watchFor(
  h: Harness,
  predicate: (snapshot: FloeSnapshot) => boolean,
  seconds: number,
  pollSeconds: number,
): Promise<Watched> {
  let snapshot = h.snapshot();
  if (predicate(snapshot)) return { hit: true, elapsed: 0, snapshot };

  let elapsed = 0;
  while (elapsed < seconds) {
    const step = Math.min(pollSeconds, seconds - elapsed);
    await h.skip(step);
    elapsed += step;
    snapshot = h.snapshot();
    if (predicate(snapshot)) return { hit: true, elapsed, snapshot };
  }
  return { hit: false, elapsed, snapshot };
}
