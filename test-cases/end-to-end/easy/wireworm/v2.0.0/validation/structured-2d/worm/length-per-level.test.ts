// worm/length-per-level — the level's worm enters at the length the formula
// gives.
//
// specs/worm.md, Length and entry: "A level brings in one worm, carrying
//
//   wormLength(level) = WORM_BASE_LENGTH + WORM_LENGTH_PER_LEVEL * (level - 1)
//
// segments, with `WORM_BASE_LENGTH` (`10`) and `WORM_LENGTH_PER_LEVEL` (`2`).
// That is `10` segments at level 1 and `32` at level 12."
//
// THREE LEVELS ARE POSED — 1, 6 and 12 — because a build has to be wrong in the
// same way at all three to pass. The base alone is right at level 1 for a build
// that forgot the per-level term (10, 10, 10 against 10, 20, 32); the per-level
// term alone is wrong at every level for one that dropped the base; and an
// off-by-one in `(level - 1)` reads 12 and 22 and 34. Each level is driven on a
// board of its own, so a failure names the level.
//
// WHAT DRIVES THE ENTRY. The level's own worm entry, not `addWorm`: this is one
// of the four points whose requirement IS that faculty, so `setWormEntry(true)`
// is turned back on after `startPlaying` shut it off, and the worm is let in
// the way play lets it in — by running the `banner` phase's timer out.
// specs/progression.md fixes that moment: "When the `banner` phase's timer runs
// out, the phase becomes `active` and the level's worm enters ... The worm
// enters at that moment and at no other." Foe spawning stays off, and no worm
// is posed by hand, so the only worm on the board is the one the level brought.
//
// The entering worm is read within a frame of its arrival, long before its
// first step is due, so what is counted is the length it entered with.

import { afterEach, beforeEach, it } from "vitest";
import {
  BANNER_TIME,
  WORM_BASE_LENGTH,
  WORM_LENGTH_PER_LEVEL,
} from "../constants";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The levels driven: the first, one in the middle, and the last of a run. */
const LEVELS = [1, 6, 12] as const;

/** The closed form specs/worm.md states, written out from the two figures. */
function expectedLength(level: number): number {
  return WORM_BASE_LENGTH + WORM_LENGTH_PER_LEVEL * (level - 1);
}

/**
 * How long the banner may take to give way, in frames.
 *
 * `BANNER_TIME` is `1.3` s (specs/progression.md); a second beyond it is a
 * bound on a banner that never ran out, not a tolerance on when it did — the
 * banner's own duration is `progression.level-banner`'s requirement.
 */
const ENTRY_TIMEOUT = ticksFor(BANNER_TIME + 1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("brings in a worm of 10 + 2 * (level - 1) segments", async () => {
  /** What entered at each level, in the order the levels were driven. */
  const entered: number[] = [];

  for (const level of LEVELS) {
    // A board of its own for each level, so no worm and no field carries over.
    resetTo(h);
    startPlaying(h);
    h.debug.setLevel(level);
    h.debug.setWormEntry(true);
    h.debug.setPhase("banner");
    h.debug.setPhaseTimer(BANNER_TIME);

    const swept = await h.until((s) => s.worms.length > 0, {
      maxFrames: ENTRY_TIMEOUT,
      poll: 1,
    });
    assertEqual(
      swept.hit,
      true,
      `level ${level}: a worm to enter within ${ENTRY_TIMEOUT} frames of the banner`,
    );
    assertLength(swept.snapshot.worms, 1, `level ${level}: worms brought in`);
    entered.push(swept.snapshot.worms[0].segments.length);

    // The last level driven is the one the still shows.
    if (level === LEVELS[LEVELS.length - 1]) captureStill(h, "entered");
  }

  for (const [index, level] of LEVELS.entries()) {
    assertEqual(
      entered[index],
      expectedLength(level),
      `level ${level}: segments the worm entered with`,
    );
  }
});
