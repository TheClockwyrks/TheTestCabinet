// scoring/level-clear-bonus — clearing a level pays SCORE_LEVEL_CLEAR per level.
//
// specs/scoring.md: "A level is cleared" pays `SCORE_LEVEL_CLEAR` (`100`) times
// "the level just cleared". The level is posed at `4` rather than at `1`, so the
// figure scales and every wrong model reads as a different number: paying a flat
// `100` leaves the whole reading `300` short, paying for the level about to open
// leaves it `100` over, and paying nothing for the clear leaves it `400` short.
//
// THE LEVEL IS CLEARED THE WAY specs/progression.md CLEARS IT: "on the step in
// which the last of its worm segments is removed". Every removal available pays
// something of its own, so the clear bonus cannot be read off one award in
// isolation — and the review item says exactly what it is read against: clearing
// level 4 "raises the score by 400 BEYOND WHAT THE KILL ITSELF PAID".
//
// SO THE READING IS A DIFFERENCE BETWEEN TWO KILLS, and the kill's own figure is
// subtracted AT THE FIGURE THIS BUILD PAYS rather than at the specification's.
// The board carries TWO worms of one segment each, which specs/worm.md calls a
// head alone. The first bolt removes a segment while the other worm still stands,
// so no level clears and what the score gains is this build's head bounty; the
// second bolt is the clearing removal, and what its gain holds over the first's
// is the clear bonus and nothing else. A build that pays the wrong figure for a
// head is docked by `scoring.head-segment` and passes here, so one defect costs
// one grade.
//
// THE WORMS STAND STILL. Both faculties are off on each, so
// specs/instrumentation.md leaves them taking no step and following nothing:
// where a head winds has nothing to do with what the clear pays, and the two
// strikes are the only things in the scenario that can move the score.
//
// THE TWO COLUMNS ARE TWELVE TILES APART, so the second bolt climbs a column the
// first kill never touched — specs/nodes.md lays a fresh inert node on the tile a
// shot segment stood on, and that node is in the first worm's column, not the
// second's.
//
// NOTHING ELSE STANDS ON THE BOARD. `startPlaying` leaves it empty with the three
// world gates shut, so no foe arrives to be killed, no worm enters to hold the
// level open, and the fresh inert nodes the dead heads lay pay nothing.
//
// WHAT THIS DOES NOT DECIDE. That the level goes up and the banner returns is
// `progression.level-advances`'s requirement. This point reads the score alone.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, SCORE_LEVEL_CLEAR, TILE } from "../../src/constants";
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
 * The tiles the two worms stand on.
 *
 * Row 10 is in the open middle of the board: clear of the entry row `0` and of the
 * player band, rows `18` and `19` (specs/board.md), so each shot is decided by the
 * worm it is aimed at. The columns are far apart so neither bolt can reach the
 * other worm or the node its kill leaves behind.
 */
const WORM_R = 10;
const SPARE_C = 14;
const CLEARING_C = 26;

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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("pays SCORE_LEVEL_CLEAR times the level beyond what the kill itself paid", async () => {
  startPlaying(h);
  h.debug.setLevel(CLEAR_LEVEL);
  for (const c of [SPARE_C, CLEARING_C]) {
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

  // The first kill leaves a worm standing, so it clears nothing and pays this
  // build's head bounty alone; the second is the clearing removal.
  const kill = await shoot(SPARE_C);
  const clearing = await shoot(CLEARING_C);
  captureStill(h, "scored");

  assertEqual(
    clearing - kill,
    SCORE_LEVEL_CLEAR * CLEAR_LEVEL,
    `what clearing level ${CLEAR_LEVEL} paid beyond the ${kill} the same ` +
      "kind of kill paid without clearing anything (specs/scoring.md: a level " +
      `cleared pays SCORE_LEVEL_CLEAR ${SCORE_LEVEL_CLEAR} times the level ` +
      "just cleared)",
  );
});
