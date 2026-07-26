// Automated validation for build.type-uniform: the component TYPE roll is uniform across the
// eight base types — over many rolls, every one of the eight appears (specs/build.md §"The
// stamp": type is uniform, 12.5% each, independent of Refinement).
//
// The variety is drawn from REPEATED rolls off each run's real seeded press, NOT from one roll
// per consecutive seed. Each run places its full five-stamp allowance and reads every
// candidate; re-seeding only refills the allowance. This matters: the roll is uniform over a
// run's draw STREAM, which is what the spec states — it is NOT a claim about how the press maps
// adjacent seeds to their first draw. A seedable-but-unhashed generator (e.g. a raw LCG whose
// first output barely moves between consecutive seeds) is spec-compliant, and reading draws
// 2..5 of each stream keeps the check independent of that.
//
// The sweep resets the run up to sixteen times, which only `arrange` may do; it consumes no
// game time, so it belongs there regardless. The act then holds on the board the sweep left
// standing long enough to capture the still.

import { startBuild, towerAt, snap, SPOTS } from "../_helpers.mjs";

// A frame for the still. 100 ms x 60 Hz = 6 ticks exactly.
const SETTLE_TICKS = 6;

export default function item() {
  // The distinct types the sweep rolled, read by `assert`.
  const types = new Set();

  return {
    id: "build.type-uniform",

    async arrange(api) {
      // Draw many rolls off each run's real seeded press: place the full five-stamp allowance
      // and read every candidate. Re-seed only to refill the allowance — the spread comes from
      // repeated draws off one press, not from the seed.
      for (let seed = 1; seed <= 16 && types.size < 8; seed += 1) {
        await startBuild(api, { seed });
        await api.call("setNextRoll", null); // clear the arming: roll the real seeded press
        for (const spot of SPOTS) {
          await api.call("placeRock", spot.col, spot.row);
          const t = towerAt(await snap(api), spot.col, spot.row);
          if (t && t.kind === "candidate") types.add(t.type);
        }
      }
    },

    async act(api) {
      await api.advance(SETTLE_TICKS);
      await api.screenshot("types");
    },

    async assert(api, check) {
      check.expectEq("all eight base component types appear across many rolls", types.size, 8);
    },
  };
}
