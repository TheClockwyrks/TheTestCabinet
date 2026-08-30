// discharge/fry-splits — a discharge through a worm's middle leaves two worms.
//
// specs/discharge.md sends a cut worm to the worm rules: "When a discharge
// removes segments from the middle of a worm, the surviving runs become worms by
// the rule `specs/worm.md` states for a worm whose segments are removed."
// specs/worm.md is that rule: "the segments that survive fall into runs of
// consecutive segments, counted from the head end. Each run becomes a worm of its
// own", and "New worms are appended to the roster in order from the head end."
//
// THE CUT IS A COLUMN THROUGH THE MIDDLE OF A LONG WORM. The worm lies flat along
// one row, `WORM_LENGTH` segments of it, and the critical node stands
// `DISCHARGE_RADIUS` rows BELOW that row — so the blast's `5 x 5` block covers
// exactly the `2 * DISCHARGE_RADIUS + 1` columns centered on the node, and the
// segments on those columns are the ones destroyed. The head-side run and the
// tail-side run are each `RUN_LENGTH` segments, both non-empty, so the answer is
// two worms and not one.
//
// THE NODE IS BELOW THE WORM, NOT ABOVE IT, and that is forced: a bolt climbs, so
// a node above the worm would sit behind a segment in the same column and
// specs/cursor.md would have the bolt strike the SEGMENT instead of the node.
// Posed below, the bolt reaches the node first and no segment is ever shot — this
// point is about a discharge cutting a worm, never about a bolt cutting one,
// which is `worm.shot-middle-splits`.
//
// THE WORM IS POSED AS A TARGET. Its STEP faculty is off, so its tiles are where
// the scenario put them when the blast resolves; whether it winds at all is the
// `worm` category's requirement, and this reading must not be able to fail
// because the worm moved a tile first.
//
// WHAT THIS DOES NOT DECIDE. Which ID each piece carries is
// `fry-split-keeps-head-id`'s requirement, so the pieces are found here by the
// TILES they stand on and never by their ids or their roster positions: a build
// that splits correctly and numbers wrongly is docked once, there.

import { afterEach, beforeEach, it } from "vitest";
import {
  BOARD_H,
  BOLT_SPEED,
  CHARGE_MAX,
  DISCHARGE_RADIUS,
} from "../../src/constants";
import { assertDeepEqual, assertLength, assertTrue } from "../assert";
import {
  captureReplay,
  createHarness,
  poseBolt,
  poseWorm,
  startPlaying,
  ticksFor,
  type Harness,
  type WormSnapshot,
} from "../harness";

/** The row the worm lies along: clear of the entry row, the band and the edges. */
const WORM_R = 6;

/** Segments each surviving run keeps, on each side of the cut. */
const RUN_LENGTH = 3;

/** The columns the blast covers: the `5 x 5` block's width. */
const CUT_WIDTH = 2 * DISCHARGE_RADIUS + 1;

/** A worm long enough to leave a run of `RUN_LENGTH` on each side of the cut. */
const WORM_LENGTH = CUT_WIDTH + 2 * RUN_LENGTH;

/** The head's tile. `poseWorm` lays the body behind it, descending columns. */
const HEAD_C = 20;

/** The tail's tile, `WORM_LENGTH - 1` columns behind the head. */
const TAIL_C = HEAD_C - (WORM_LENGTH - 1);

/**
 * The critical node's tile: `DISCHARGE_RADIUS` rows below the worm's row, in the
 * column at the middle of the chain.
 *
 * At that offset the blast's Chebyshev reach into the worm's row is exactly
 * `DISCHARGE_RADIUS` columns each side, so the cut is `CUT_WIDTH` wide.
 */
const STRUCK_C = HEAD_C - (RUN_LENGTH + DISCHARGE_RADIUS);
const STRUCK_R = WORM_R + DISCHARGE_RADIUS;

/** The head-side run: the `RUN_LENGTH` segments in front of the cut. */
const HEAD_RUN = Array.from({ length: RUN_LENGTH }, (_, i) => ({
  c: HEAD_C - i,
  r: WORM_R,
}));

/** The tail-side run: the `RUN_LENGTH` segments behind the cut, head end first. */
const TAIL_RUN = Array.from({ length: RUN_LENGTH }, (_, i) => ({
  c: TAIL_C + (RUN_LENGTH - 1) - i,
  r: WORM_R,
}));

/**
 * The most frames the bolt is given to resolve.
 *
 * specs/cursor.md flies a bolt straight up at `BOLT_SPEED` (`900` units per
 * second), so a bolt posed one tile below its target needs half a tile of climb.
 * The ceiling is the whole board's height at that speed (`640 / 900`), far past
 * what the strike needs and still bounded.
 */
const BOLT_SWEEP_TICKS = ticksFor(BOARD_H / BOLT_SPEED);

/** The worm standing on `tile`, or `undefined` where no piece holds it. */
function pieceOn(
  worms: readonly WormSnapshot[],
  tile: { c: number; r: number },
): WormSnapshot | undefined {
  return worms.find((worm) =>
    worm.segments.some((seg) => seg.c === tile.c && seg.r === tile.r),
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the head-side and tail-side runs as two worms", async () => {
  startPlaying(h);
  h.debug.setNode(STRUCK_C, STRUCK_R, CHARGE_MAX);
  const worm = poseWorm(h, HEAD_C, WORM_R, WORM_LENGTH);
  h.debug.setWormStepping(worm, false);
  poseBolt(h, STRUCK_C, STRUCK_R + 1);

  const swept = await captureReplay(h, "split", () =>
    h.until((s) => s.bolts.length === 0, { maxFrames: BOLT_SWEEP_TICKS }),
  );

  assertTrue(
    swept.hit,
    "the bolt to resolve and leave flight within the sweep (specs/cursor.md)",
  );
  assertLength(
    swept.snapshot.worms,
    2,
    `the worms on the board after a discharge cut ${CUT_WIDTH} segments out ` +
      `of the middle of a ${WORM_LENGTH}-segment worm`,
  );

  assertDeepEqual(
    pieceOn(swept.snapshot.worms, HEAD_RUN[0])?.segments,
    HEAD_RUN,
    "the segments of the piece standing where the worm's head was: the " +
      "surviving run in front of the cut, its leading segment first",
  );
  assertDeepEqual(
    pieceOn(swept.snapshot.worms, TAIL_RUN[0])?.segments,
    TAIL_RUN,
    "the segments of the piece standing behind the cut: the surviving run " +
      "from the break to the old tail, the segment nearest the break first",
  );
});
