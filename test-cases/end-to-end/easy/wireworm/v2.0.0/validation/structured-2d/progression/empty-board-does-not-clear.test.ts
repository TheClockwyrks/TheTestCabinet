// progression/empty-board-does-not-clear — a board that never held a segment is
// being played, not cleared.
//
// specs/progression.md, Clearing a level: a level clears on the step in which the
// last of its worm segments is REMOVED — the clear IS that removal — so a board
// that holds no worm segments and has had none removed is being played rather
// than cleared, and the level stands. This is the other direction of the rule
// `level-clears-on-last-segment` decides.
//
// IT IS LOAD-BEARING FOR THE WHOLE SUITE. `startPlaying` poses an EMPTY board,
// and every mechanical scenario in this project stands on it. A build that reads
// the empty board as a clear advances the level, opens a banner, or ends the run
// underneath every one of those scenarios, so this point is capped `broken` in
// its own right.
//
// THE BOARD IS LEFT ALONE FOR SEVERAL SECONDS. Long enough that a build clearing
// on a predicate rather than on a removal has had every chance to do it — past
// `BANNER_TIME`, past a respawn, past several worm step intervals at this level
// — with all three world gates off, so nothing arrives to end the emptiness and
// nothing but the build's own reading of the board can change anything.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";

/** The level the empty board is posed at, and the level it must still be on. */
const LEVEL = 1;

/**
 * How long the empty board is left running, in seconds.
 *
 * `5` s. specs/progression.md's longest phase is `RESPAWN_TIME` (`1.4` s) and
 * its banner is `BANNER_TIME` (`1.3` s), so five seconds is more than three of
 * either: a build that clears on an empty board has had time to clear, open a
 * banner, and clear again before this reads.
 */
const SETTLE = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("is still on the same level, still playing, several seconds on", async () => {
  startPlaying(h);
  await h.advanceSeconds(SETTLE);
  captureStill(h, "playing");

  const after = h.snapshot();
  assertEqual(after.level, LEVEL, `the level after ${SETTLE} s of empty board`);
  assertEqual(after.screen, "playing", "the screen the empty board is on");
  assertEqual(after.phase, "active", "the phase the empty board is in");
});
