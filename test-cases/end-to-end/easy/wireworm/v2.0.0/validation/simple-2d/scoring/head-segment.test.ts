// scoring/head-segment — a bolt into the head pays SCORE_HEAD.
//
// specs/scoring.md fixes the figure: "A bolt destroys a worm's head" pays
// `SCORE_HEAD` (`100`), against `SCORE_BODY` (`10`) for every other segment, and
// the file then closes its list — "Nothing else scores" — so the fresh inert node
// the dead head leaves behind (specs/nodes.md) pays nothing on top of it.
//
// THE SEGMENT STRUCK IS THE LEADING ONE, which specs/worm.md names the head. The
// worm is three segments long, so head and body are different tiles and every
// wrong model of the figure reads as a different number: a build paying the body
// figure for every segment reads `10`, one paying nothing reads `0`, and one that
// also paid for the node the head left behind reads `101`.
//
// THE WORM STANDS STILL. Both faculties are off, so specs/instrumentation.md
// leaves it taking no step and following nothing: the bolt strikes the head on the
// tile the pose put it on, and the strike is the only thing in the scenario that
// can move the score. Three segments also keep the level from clearing on the
// removal — a level clears on the step in which the LAST of its segments goes
// (specs/progression.md) — and the clear bonus would otherwise land in this same
// reading.
//
// WHAT THIS DOES NOT DECIDE. That the bolt removes the head and leaves the worm
// one shorter is `worm.shot-head-shortens`'s requirement, and that the dead head
// lays a node is `nodes.shot-leaves-node`'s. This point reads the score alone.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, SCORE_HEAD, TILE } from "../../src/constants";
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
 * The row the worm is laid along, and the column its head stands in.
 *
 * Row 10 is in the open middle of the board: clear of the entry row `0` and of the
 * player band, rows `18` and `19` (specs/board.md), so the shot is decided by the
 * worm alone.
 */
const WORM_R = 10;
const HEAD_C = 20;

/** How many segments the worm carries. */
const WORM_LENGTH = 3;

/** How far below the head the bolt is posed, in tiles. */
const BOLT_DROP_TILES = 4;

/**
 * How long the bolt is given to reach the head, in frames.
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

it("pays exactly SCORE_HEAD for a head a bolt destroys", async () => {
  startPlaying(h);
  const worm = poseWorm(h, HEAD_C, WORM_R, WORM_LENGTH, 1, 1);
  h.debug.setWormStepping(worm, false);
  h.debug.setWormBody(worm, false);

  const before = h.snapshot().score;
  poseBolt(h, HEAD_C, WORM_R + BOLT_DROP_TILES);

  await h.until((s) => s.bolts.length === 0, { maxFrames: BOLT_TICKS });
  captureStill(h, "scored");

  assertEqual(
    h.snapshot().score - before,
    SCORE_HEAD,
    "the score the bolt into the head added",
  );
});
