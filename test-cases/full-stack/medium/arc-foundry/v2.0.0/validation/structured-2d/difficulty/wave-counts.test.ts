// difficulty/wave-counts — a run runs the number of waves its difficulty states.
//
// THE REQUIREMENT. `specs/difficulty.md` fixes the wave count `N` per difficulty:
// `40` on Easy, `50` on Medium, `60` on Hard. `specs/instrumentation.md` has the
// snapshot report it as `totalWaves`, and `specs/campaign.md` numbers the waves
// `1` through `N` with the counter at `0` before wave `1`, so a run that has just
// opened stands before its first wave with its whole length already fixed.
//
// HOW IT IS DECIDED. A run is opened at each difficulty in turn, through the same
// path confirming the difficulty select takes, and `totalWaves` is read straight
// back off the snapshot before anything is advanced: the count is a property of
// the run the moment it opens, not of anything that happens in it. The one frame
// that runs afterwards draws the run the last reading was taken from, which is
// what the still is of; the build phase is untimed (`specs/campaign.md`), so it
// moves nothing this check read.
//
// WHAT THIS POINT IS NOT. That clearing wave `N` ends the run is the campaign
// checklist's `victory-after-final-wave`, and how tough wave `N` is is
// `scaling-constants` next door. This point decides the number alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual } from "../assert";
import { DIFFICULTIES } from "../../src/constants";
import { captureStill, createHarness, openRun, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reports the wave count each difficulty states", async () => {
  const counts: number[] = [];

  for (const difficulty of DIFFICULTIES) {
    openRun(h, { difficulty: difficulty.id });
    const s = h.snapshot();

    assertEqual(
      s.difficulty,
      difficulty.id,
      "the difficulty the run opened at (specs/instrumentation.md)",
    );
    assertEqual(
      s.totalWaves,
      difficulty.waves,
      `totalWaves on ${difficulty.id} (specs/difficulty.md)`,
    );
    // Waves are numbered 1 through N, so a run that has just opened stands
    // before wave 1 with the whole of its length still ahead of it
    // (specs/campaign.md).
    assertEqual(
      s.wave,
      0,
      `the wave counter of a run just opened on ${difficulty.id} ` +
        "(specs/campaign.md)",
    );
    counts.push(s.totalWaves);
  }

  await h.advance(1);
  captureStill(h, "counts");

  // The three are three different lengths of run, so a build reporting one
  // number whatever was chosen fails here rather than passing three times over.
  assertNotEqual(
    counts[0],
    counts[1],
    "Easy and Medium to run different numbers of waves (specs/difficulty.md)",
  );
  assertNotEqual(
    counts[1],
    counts[2],
    "Medium and Hard to run different numbers of waves (specs/difficulty.md)",
  );
});
