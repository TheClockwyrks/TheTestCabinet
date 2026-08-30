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
// WHAT IS FILMED, AND WHY THE WHOLE SWEEP IS NOT. The verdict needs as many rolls as it takes for
// all eight types to turn up, which is up to sixteen runs of five stamps — eighty placements
// across eighty resets. That is not something to watch, and the still it used to end on was worse
// than not watching it: a single frame of the last run's five candidates, showing five of the
// eight types the check counted, on a board that has nothing to do with the seventy-five rolls
// that produced the verdict.
//
// So the sweep stays in `arrange`, instant and off camera, and the act re-rolls ONE run's
// allowance on camera a beat at a time. The clip cannot show a distribution — no clip of a random
// process can — but it can show the thing the distribution is a claim about: the press pulled
// five times, handing out a different component each time, drawn as it lands. The count across
// the whole sweep is what the verdict rests on and it is reported in the assertion.

import { startBuild, towerAt, snap, SPOTS, SECOND } from "../_helpers.mjs";

// A beat between drops, so each roll lands and reads as its own before the next one does.
const BEAT_TICKS = 0.9 * SECOND;
// A beat on the finished board, with the run's whole spread standing together.
const TAIL_TICKS = 1.5 * SECOND;

export default function item() {
  // The distinct types the sweep rolled, read by `assert`, and the run the act re-rolls.
  const types = new Set();
  // The run the act re-rolls on camera: the one whose own five stamps landed the most distinct
  // types, so the clip is the widest single spread the press actually handed out rather than an
  // arbitrary one.
  let shownSeed = 1;
  let shownSpread = 0;

  return {
    id: "build.type-uniform",

    async arrange(api) {
      // Draw many rolls off each run's real seeded press: place the full five-stamp allowance
      // and read every candidate. Re-seed only to refill the allowance — the spread comes from
      // repeated draws off one press, not from the seed.
      for (let seed = 1; seed <= 16 && types.size < 8; seed += 1) {
        await startBuild(api, { seed });
        await api.call("setNextRoll", null); // clear the arming: roll the real seeded press
        const thisRun = new Set();
        for (const spot of SPOTS) {
          await api.call("placeRock", spot.col, spot.row);
          const t = towerAt(await snap(api), spot.col, spot.row);
          if (t && t.kind === "candidate") {
            types.add(t.type);
            thisRun.add(t.type);
          }
        }
        if (thisRun.size > shownSpread) {
          shownSpread = thisRun.size;
          shownSeed = seed;
        }
      }
      // Reopen the run the act re-rolls, so it opens on an empty yard with a full allowance.
      await startBuild(api, { seed: shownSeed });
    },

    async act(api) {
      for (const spot of SPOTS) {
        await api.call("setNextRoll", null);
        await api.call("placeRock", spot.col, spot.row);
        await api.advance(BEAT_TICKS);
      }

      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectEq("all eight base component types appear across many rolls", types.size, 8);
    },
  };
}
