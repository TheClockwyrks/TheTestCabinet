// difficulty/same-opening-allocation — every difficulty opens a run the same.
//
// THE REQUIREMENT. `specs/difficulty.md` is explicit about the negative: "A
// difficulty sets the number of waves and the constants of the per-wave health
// scaling, and nothing else. Every other value is identical at every difficulty:
// the starting Charge, the starting Grid Integrity, the stamp allowance, the
// refinement track and its costs, the Load roster's base figures, the bounties,
// the leak values, the wave-clear bonus, the component stats, and the recipes."
//
// ONE GROUP PER CHECK. Those figures are reached five different ways — off a fresh
// run, off the refinement track, off standing structures, off the inspector, and
// off a unit actually dying or leaking — and a build can leak the difficulty into
// one of the five and not the others, so each is decided on its own and a grade
// names which one drifted. This one is about the allocation a run opens with.
//
// THE COMPARISON IS BETWEEN THE DIFFICULTIES, not against the specification's
// numbers: whether the starting Charge is `10`, what a Slug's bounty is, and what
// a Charged Capacitor hits for are each decided by a point of their own on the
// economy, campaign and component checklists, and a build that gets one of them
// wrong should fail that point once rather than twice over. What is decided HERE
// is that whichever figure a build carries, it carries the same one at Easy, at
// Medium and at Hard.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import type { DifficultyId } from "../constants";
import { captureStill, createHarness, openRun, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/**
 * Read one figure at each difficulty in turn and hold the three against each
 * other.
 *
 * The Easy reading is the one the other two are compared to, so a failure names
 * the difficulty that drifted and what it drifted to.
 */
async function sameAtEveryDifficulty<T>(
  what: string,
  read: (difficulty: DifficultyId) => Promise<T>,
): Promise<T> {
  const easy = await read("easy");
  for (const difficulty of ["medium", "hard"] as const) {
    const other = await read(difficulty);
    assertDeepEqual(
      other,
      easy,
      `${what} to be the same at ${difficulty} as at easy, because difficulty ` +
        "sets the wave count and the health scaling alone (specs/difficulty.md)",
    );
  }
  return easy;
}

it("opens every run with the same Charge, Integrity, stamps and refinement", async () => {
  await sameAtEveryDifficulty(
    "a run's opening allocation",
    async (difficulty) => {
      openRun(h, { difficulty });
      const s = h.snapshot();
      return {
        charge: s.charge,
        integrity: s.integrity,
        stampsLeft: s.stampsLeft,
        refinement: s.refinement,
      };
    },
  );
  // The allocations are read and compared above; the one frame the still is of
  // draws the last run opened, and the build phase is untimed.
  await h.advance(1);
  captureStill(h, "same");
});
