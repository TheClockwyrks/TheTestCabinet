// scoring/body-segment — a bolt into a body segment pays SCORE_BODY.
//
// specs/scoring.md fixes the figure: "A bolt destroys any other worm segment"
// pays `SCORE_BODY` (`10`), against `SCORE_HEAD` (`100`) for the head, and the
// file then closes its list — "Nothing else scores" — so the fresh inert node the
// dead segment leaves behind (specs/nodes.md) pays nothing on top of it.
//
// THE SEGMENT STRUCK IS NEITHER THE HEAD NOR THE TAIL. Three segments are posed
// and the middle one is shot, so every wrong model of the figure reads as a
// different number: a build paying the head figure for every segment reads `100`,
// one paying nothing reads `0`, and one that also paid for the node the segment
// left behind reads `11`.
//
// THE WORM STANDS STILL. Both faculties are off, so specs/instrumentation.md
// leaves it taking no step and following nothing: the bolt strikes the segment on
// the tile the pose put it on, and the strike is the only thing in the scenario
// that can move the score. Three segments also keep the level from clearing on the
// removal — a level clears on the step in which the LAST of its segments goes
// (specs/progression.md) — and the clear bonus would otherwise land in this same
// reading.
//
// WHAT THIS DOES NOT DECIDE. That the bolt removes the segment and splits the worm
// is `worm.shot-mid-splits`'s requirement, and that the dead segment lays a node
// is `nodes.shot-leaves-node`'s. This point reads the score alone.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, SCORE_BODY, TILE } from "../../src/constants";
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

/** How many segments the worm carries, and which of them the bolt is aimed at. */
const WORM_LENGTH = 3;
const BODY_C = HEAD_C - 1;

/** How far below the struck segment the bolt is posed, in tiles. */
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

it("pays exactly SCORE_BODY for a body segment a bolt destroys", async () => {
  startPlaying(h);
  const worm = poseWorm(h, HEAD_C, WORM_R, WORM_LENGTH, 1, 1);
  h.debug.setWormStepping(worm, false);
  h.debug.setWormBody(worm, false);

  const before = h.snapshot().score;
  poseBolt(h, BODY_C, WORM_R + BOLT_DROP_TILES);

  await h.until((s) => s.bolts.length === 0, { maxFrames: BOLT_TICKS });
  captureStill(h, "scored");

  assertEqual(
    h.snapshot().score - before,
    SCORE_BODY,
    "the score the bolt into the middle segment added",
  );
});
