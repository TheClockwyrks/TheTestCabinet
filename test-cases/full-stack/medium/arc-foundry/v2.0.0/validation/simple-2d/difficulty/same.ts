// Arc Foundry — reading one figure at all three difficulties. CASE-PROVIDED,
// LOCAL TO THIS CATEGORY.
//
// `specs/difficulty.md` is explicit about the negative: "A difficulty sets the
// number of waves and the constants of the per-wave health scaling, and nothing
// else. Every other value is identical at every difficulty: the starting Charge,
// the starting Grid Integrity, the stamp allowance, the refinement track and its
// costs, the Load roster's base figures, the bounties, the leak values, the
// wave-clear bonus, the component stats, and the recipes."
//
// Each of those groups is reached a different way — off a fresh run, off the
// refinement track, off standing structures, off the inspector, and off a unit
// actually dying or leaking — so each is a point of its own, and each of those
// suites reads its own group through the helper here.
//
// THE COMPARISON IS BETWEEN THE DIFFICULTIES, NEVER AGAINST A NUMBER. Whether the
// starting Charge is `10`, what a Slug's bounty is, and what a Charged Capacitor
// hits for are each decided by a point of their own on the economy, campaign and
// component checklists, and a build that gets one of them wrong should fail that
// point once rather than twice over. What is decided in this category is that
// whichever figure a build carries, it carries the same one at Easy, at Medium and
// at Hard.

import { assertDeepEqual } from "../assert";
import type { DifficultyId } from "../constants";

/**
 * Read one figure at each difficulty in turn and hold the three against each
 * other.
 *
 * The Easy reading is the one the other two are compared to, so a failure names
 * the difficulty that drifted and what it drifted to.
 */
export async function sameAtEveryDifficulty<T>(
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
