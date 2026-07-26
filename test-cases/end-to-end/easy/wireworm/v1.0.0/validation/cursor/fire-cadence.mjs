// Automated validation for cursor.fire-cadence: held fire respects a minimum
// interval between bolts (~0.15 s) and never puts more than three bolts in flight.
//
// Fire is held with injected input (so it flows through the real updateFiring
// cadence, not the debug fire() that bypasses it). Within the first 0.15 s only one
// bolt appears (cadence); over a longer hold the bolts-in-flight count never exceeds
// three (the cap).

import { freshBoard, tileCX } from "../_helpers.mjs";

// The cadence window is ~0.15s = 18 ticks. The old probe waited 0.14s, which is
// 16.8 ticks — not a whole tick count, and the contract refuses a fraction rather
// than rounding it. Round DOWN to 16: this check's whole point is to sample from
// strictly INSIDE the window, and 18 would land exactly on the cadence boundary
// where a second bolt may legitimately have been fired. (17 would serve too; 16
// leaves a tick of margin against a build whose cadence rounds the other way.)
const INSIDE_CADENCE_TICKS = 16;

// The cap sweep held fire for 120 iterations of 0.0125s — 1.5s in total, sampled 120
// times. 0.0125s is 1.5 ticks, again not a whole number. What this loop probes is the
// PEAK bolts-in-flight over a long hold, so what matters is the total duration and a
// sampling cadence fine enough to catch the peak, not the fractional per-iteration
// value. Keep the total exactly (180 ticks = 1.5s) and poll every 2 ticks, giving 90
// samples — dense against a bolt's multi-tick flight time, so the peak cannot slip
// between reads.
const CAP_SWEEP_TICKS = 180;
const CAP_SWEEP_POLL = 2;

export default function item() {
  let firstWindowBolts;
  let maxBolts = 0;

  return {
    id: "cursor.fire-cadence",

    async arrange(api) {
      await freshBoard(api);
      await api.call("setCursor", tileCX(20), 688); // an empty column, so bolts stay in flight
    },

    // The whole held-fire burst IS the clip: the reviewer watches the cadence space
    // the bolts out and the count top out at three.
    async act(api) {
      await api.call("keyDown", "Space");
      // Within the first cadence window only one bolt should have been fired.
      await api.advance(INSIDE_CADENCE_TICKS);
      firstWindowBolts = (await api.snapshot()).bolts.length;

      // Hold and sample: the bolts-in-flight count is capped at three. The predicate
      // never returns true — it is the sampler, and `until` simply runs the sweep out.
      await api.until(
        (s) => {
          maxBolts = Math.max(maxBolts, s.bolts.length);
          return false;
        },
        { max: CAP_SWEEP_TICKS, poll: CAP_SWEEP_POLL },
      );
      await api.call("keyUp", "Space");
    },

    async assert(api, check) {
      check.expectLe(
        "at most one bolt within the ~0.15 s cadence window",
        firstWindowBolts,
        1,
      );
      check.expectGt("holding fire does put bolts in flight", maxBolts, 0);
      check.expectLe(
        "never more than three bolts in flight at once",
        maxBolts,
        3,
      );
    },
  };
}
