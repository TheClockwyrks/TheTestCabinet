// difficulty — holding one figure against itself at all three difficulties.
// CASE-PROVIDED, LOCAL TO THIS CATEGORY.
//
// Not a suite: vitest collects `*.test.ts` alone.
//
// `specs/difficulty.md` names several things that must not move with the
// difficulty, and each is its own point because a build can get any one of them
// wrong on its own. What every one of those points does is the same shape: read
// one group of figures at each difficulty in turn, and hold the three readings
// against each other. That reading lives here so the five say it the same way.
//
// THE COMPARISON IS BETWEEN THE DIFFICULTIES, never against the specification's
// numbers. What the starting Charge is, what a Slug's bounty is and what a
// Charged Capacitor hits for are each decided by a point of their own on the
// economy, campaign and component checklists, and a build that gets one of them
// wrong should fail that point once rather than twice over.

import { assertDeepEqual } from "../assert";
import type { DifficultyId } from "../constants";

/**
 * Read one group of figures at each difficulty in turn and hold the three
 * against each other.
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

/** The anchors a structure is stood on: clear of every map's chain. */
export const BENCH = [
  { col: 10, row: 0 },
  { col: 13, row: 0 },
  { col: 16, row: 0 },
  { col: 19, row: 0 },
];
