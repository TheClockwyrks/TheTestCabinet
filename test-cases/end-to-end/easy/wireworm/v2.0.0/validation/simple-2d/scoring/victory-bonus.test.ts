// scoring/victory-bonus — winning pays SCORE_VICTORY per life remaining.
//
// specs/scoring.md: "The run is won" pays `SCORE_VICTORY` (`250`) times "the lives
// remaining", and "the victory bonus is paid on top of level `12`'s clear bonus".
// The run is posed with two lives left, so the figure scales and every wrong model
// reads as a different number: paying a flat `250` leaves the reading `250` short,
// paying for the three lives a run starts with leaves it `250` over, and paying
// nothing for the victory leaves it `500` short.
//
// THE RUN IS WON THE WAY specs/progression.md WINS IT: "the last worm segment of
// level `12` is removed". The board carries one worm of one segment at
// `TOTAL_LEVELS`, which specs/worm.md calls a head alone, so the single bolt below
// is that removal. It therefore pays three figures at once — `SCORE_HEAD` for the
// kill, `SCORE_LEVEL_CLEAR` times `12` for the clear, and the victory bonus on top
// — and the reading is the sum; `scoring.head-segment` and
// `scoring.level-clear-bonus` grade the first two, and the victory bonus is what
// is left over.
//
// THE WORM STANDS STILL. Both faculties are off, so specs/instrumentation.md
// leaves it taking no step and following nothing: where the head winds has nothing
// to do with what victory pays, and the strike and the win it triggers are the
// only things in the scenario that can move the score.
//
// TWO LIVES, NOT THREE, and the score climbs to `1,800` — well short of
// `BONUS_LIFE_EVERY` (`12,000`), so no bonus life is granted mid-scenario and the
// lives the bonus is reckoned against are the lives the pose set.
//
// WHAT THIS DOES NOT DECIDE. That the game moves to the victory screen is
// `progression.victory-screen`'s requirement. This point reads the score alone.

import { afterEach, beforeEach, it } from "vitest";
import {
  BOLT_SPEED,
  SCORE_HEAD,
  SCORE_LEVEL_CLEAR,
  SCORE_VICTORY,
  TILE,
  TOTAL_LEVELS,
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
 * The lives standing when the run is won.
 *
 * Two, so `SCORE_VICTORY * lives` is a different figure from `SCORE_VICTORY`
 * itself and from the `START_LIVES` (`3`) a run opens with
 * (specs/progression.md).
 */
const LIVES_AT_VICTORY = 2;

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
 * `SCORE_LEVEL_CLEAR` times `TOTAL_LEVELS` for the clear that removal is, and
 * `SCORE_VICTORY` times the lives remaining on top of it (specs/scoring.md).
 */
const EXPECTED_AWARD =
  SCORE_HEAD +
  SCORE_LEVEL_CLEAR * TOTAL_LEVELS +
  SCORE_VICTORY * LIVES_AT_VICTORY;

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

it("pays SCORE_VICTORY per life on top of level 12's clear bonus", async () => {
  startPlaying(h);
  h.debug.setLevel(TOTAL_LEVELS);
  h.debug.setLives(LIVES_AT_VICTORY);
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
    `${SCORE_HEAD} for the head shot, ` +
      `${SCORE_LEVEL_CLEAR * TOTAL_LEVELS} for clearing level ${TOTAL_LEVELS}, ` +
      `and ${SCORE_VICTORY * LIVES_AT_VICTORY} for the ${LIVES_AT_VICTORY} ` +
      `lives left`,
  );
});
