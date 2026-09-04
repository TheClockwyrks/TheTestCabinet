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
// level `12` is removed". That removal pays three figures at once — the head
// bounty for the kill, level `12`'s clear bonus, and the victory bonus on top —
// and the review item names the one it is read against: winning with two lives
// left "adds 500 BEYOND THE LEVEL-12 CLEAR BONUS".
//
// SO THE KILL'S OWN FIGURE IS SUBTRACTED AT THE FIGURE THIS BUILD PAYS, and the
// clear bonus at the specification's. The board carries TWO worms of one segment
// each, which specs/worm.md calls a head alone. The first bolt removes a segment
// while the other worm still stands, so nothing clears and what the score gains is
// this build's head bounty; the second bolt is the winning removal, and what its
// gain holds over the first's is level 12's clear bonus and the victory bonus
// together. A build that pays the wrong figure for a head is docked by
// `scoring.head-segment` and passes here, so that defect costs one grade rather
// than two.
//
// THE WORMS STAND STILL. Both faculties are off on each, so
// specs/instrumentation.md leaves them taking no step and following nothing: where
// a head winds has nothing to do with what victory pays, and the two strikes are
// the only things in the scenario that can move the score.
//
// THE TWO COLUMNS ARE TWELVE TILES APART, so the second bolt climbs a column the
// first kill never touched — specs/nodes.md lays a fresh inert node on the tile a
// shot segment stood on, and that node is in the first worm's column, not the
// second's.
//
// TWO LIVES, NOT THREE, and the score climbs to `1,900` — well short of
// `BONUS_LIFE_EVERY` (`12,000`), so no bonus life is granted mid-scenario and the
// lives the bonus is reckoned against are the lives the pose set.
//
// WHAT THIS DOES NOT DECIDE. That the game moves to the victory screen is
// `progression.victory-on-twelve`'s requirement. This point reads the score alone.

import { afterEach, beforeEach, it } from "vitest";
import {
  BOLT_SPEED,
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
 * The tiles the two worms stand on.
 *
 * Row 10 is in the open middle of the board: clear of the entry row `0` and of the
 * player band, rows `18` and `19` (specs/board.md), so each shot is decided by the
 * worm it is aimed at. The columns are far apart so neither bolt can reach the
 * other worm or the node its kill leaves behind.
 */
const WORM_R = 10;
const SPARE_C = 14;
const WINNING_C = 26;

/** How far below a segment its bolt is posed, in tiles. */
const BOLT_DROP_TILES = 4;

/**
 * How long a bolt is given to reach its segment, in frames.
 *
 * specs/cursor.md has a bolt climb at `BOLT_SPEED` (`900` units per second) and
 * resolve when "the bolt's centre is inside the segment's tile". Posed four tiles
 * below it, its centre starts `3.5` tiles — `112` units — under that tile's lower
 * edge, which is `0.124` s of flight. Twice that is the budget, so a conforming
 * build has ample room and a build whose bolt never resolves still reaches a
 * verdict rather than running the suite out.
 */
const BOLT_TICKS = 2 * ticksFor(((BOLT_DROP_TILES - 0.5) * TILE) / BOLT_SPEED);

/**
 * What the winning removal owes beyond the kill it also is: `SCORE_LEVEL_CLEAR`
 * times `TOTAL_LEVELS` for the clear, and `SCORE_VICTORY` times the lives
 * remaining on top of it (specs/scoring.md).
 */
const EXPECTED_BEYOND_THE_KILL =
  SCORE_LEVEL_CLEAR * TOTAL_LEVELS + SCORE_VICTORY * LIVES_AT_VICTORY;

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
  for (const c of [SPARE_C, WINNING_C]) {
    const worm = poseWorm(h, c, WORM_R, 1, 1, 1);
    h.debug.setWormStepping(worm, false);
    h.debug.setWormBody(worm, false);
  }

  /** Shoot the head standing in column `c` and answer what the score gained. */
  const shoot = async (c: number): Promise<number> => {
    const before = h.snapshot().score;
    poseBolt(h, c, WORM_R + BOLT_DROP_TILES);
    await h.until((s) => s.bolts.length === 0, { maxFrames: BOLT_TICKS });
    return h.snapshot().score - before;
  };

  // The first kill leaves a worm standing, so it wins nothing and pays this
  // build's head bounty alone; the second is the winning removal.
  const kill = await shoot(SPARE_C);
  const winning = await shoot(WINNING_C);
  captureStill(h, "scored");

  assertEqual(
    winning - kill,
    EXPECTED_BEYOND_THE_KILL,
    `what winning on level ${TOTAL_LEVELS} with ${LIVES_AT_VICTORY} lives ` +
      `paid beyond the ${kill} the same kind of kill paid without winning ` +
      `— ${SCORE_LEVEL_CLEAR * TOTAL_LEVELS} for the clear and ` +
      `${SCORE_VICTORY * LIVES_AT_VICTORY} for the lives left ` +
      "(specs/scoring.md)",
  );
});
