// scoring/level-clear-bonus — clearing a level pays SCORE_LEVEL_CLEAR per level.
//
// specs/scoring.md: "A level is cleared" pays `SCORE_LEVEL_CLEAR` (`100`) times
// "the level just cleared". The level is posed at `4` rather than at `1`, so the
// figure scales and every wrong model reads as a different number: paying a flat
// `100` leaves the whole reading `300` short, paying for the level about to open
// leaves it `100` over, and paying nothing for the clear leaves it `400` short.
//
// THE LEVEL IS CLEARED THE WAY specs/progression.md CLEARS IT: "on the step in
// which the last of its worm segments is removed". The board carries one worm of
// one segment, which specs/worm.md calls a head alone, so the single bolt below is
// that removal. The kill therefore pays `SCORE_HEAD` as well, and the reading is
// the pair; `scoring.head-segment` grades the kill's own figure, and the clear
// bonus is what is left over.
//
// THE WORM STANDS STILL. Both faculties are off, so specs/instrumentation.md
// leaves it taking no step and following nothing: where the head winds has nothing
// to do with what the clear pays, and the strike and the clear it triggers are the
// only things in the scenario that can move the score.
//
// NOTHING ELSE STANDS ON THE BOARD. `startPlaying` leaves it empty with the three
// world gates shut, so no foe arrives to be killed, no worm enters to hold the
// level open, and the fresh inert node the dead head lays (specs/nodes.md) pays
// nothing.
//
// WHAT THIS DOES NOT DECIDE. That the level goes up and the banner returns is
// `progression.clear-advances`'s requirement. This point reads the score alone.

import { afterEach, beforeEach, it } from "vitest";
import {
  BOLT_SPEED,
  SCORE_HEAD,
  SCORE_LEVEL_CLEAR,
  TILE,
} from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseBolt,
  poseWorm,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * The level being cleared.
 *
 * Four, so `SCORE_LEVEL_CLEAR * level` is a different figure from
 * `SCORE_LEVEL_CLEAR` itself, from the level above it, and from the level below
 * it. Nothing else about the level is used: `startPlaying` shuts the world gates,
 * so the level's own foe spawning and worm entry stay out of the scenario.
 */
const CLEAR_LEVEL = 4;

/**
 * The tile the worm's one segment stands on.
 *
 * Row 10 is in the open middle of the board: clear of the entry row `0` and of the
 * player band, rows `18` and `19` (specs/board.md), so the shot is decided by the
 * worm alone.
 */
const WORM_C = 20;
const WORM_R = 10;

/**
 * What the whole scenario owes: `SCORE_HEAD` for the segment the bolt destroys,
 * which specs/worm.md makes the head of a one-segment worm, and
 * `SCORE_LEVEL_CLEAR` times `CLEAR_LEVEL` for the clear that removal is
 * (specs/scoring.md).
 */
const EXPECTED_AWARD = SCORE_HEAD + SCORE_LEVEL_CLEAR * CLEAR_LEVEL;

/** How far below the segment the bolt is posed, in tiles. */
const BOLT_DROP_TILES = 4;

/**
 * How long the bolt is given to reach the segment, in frames.
 *
 * specs/cursor.md has a bolt climb at `BOLT_SPEED` (`900` units per second) and
 * resolve when "the bolt's centre is inside the segment's tile". Posed four tiles
 * below it, its centre starts `3.5` tiles — `112` units — under that tile's lower
 * edge, which is `0.124` s of flight. Twice that is the budget, so a conforming
 * build has ample room and a build whose bolt never resolves still reaches a
 * verdict rather than running the suite out.
 */
const BOLT_TICKS = 2 * ticksFor(((BOLT_DROP_TILES - 0.5) * TILE) / BOLT_SPEED);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("pays SCORE_LEVEL_CLEAR times the level on the clearing removal", async () => {
  startPlaying(h);
  h.debug.setLevel(CLEAR_LEVEL);
  const worm = poseWorm(h, WORM_C, WORM_R, 1, 1, 1);
  h.debug.setWormStepping(worm, false);
  h.debug.setWormBody(worm, false);

  const before = h.snapshot().score;
  poseBolt(h, WORM_C, WORM_R + BOLT_DROP_TILES);

  await h.until((s) => s.bolts.length === 0, { maxFrames: BOLT_TICKS });
  captureStill(h, "scored");

  assertEqual(
    h.snapshot().score - before,
    EXPECTED_AWARD,
    `${SCORE_HEAD} for the head shot and ` +
      `${SCORE_LEVEL_CLEAR * CLEAR_LEVEL} for clearing level ${CLEAR_LEVEL}`,
  );
});
