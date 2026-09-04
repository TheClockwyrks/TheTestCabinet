// discharge/fry-splits — a discharge through a worm's middle leaves two worms.
//
// specs/discharge.md sends a cut worm to the worm rules: "When a discharge
// removes segments from the middle of a worm, the surviving runs become worms by
// the rule `specs/worm.md` states for a worm whose segments are removed."
// specs/worm.md is that rule: "the segments that survive fall into runs of
// consecutive segments, counted from the head end. Each run becomes a worm of its
// own", the first run's "leading segment is its head", and for each further run
// "Its leading segment is the one that was nearest the break, and that segment is
// its head".
//
// THE CUT IS A COLUMN THROUGH THE MIDDLE OF A LONG WORM. The worm lies flat along
// one row, `WORM_LENGTH` segments of it, and the critical node stands ONE row
// below that row, in the column at the middle of the chain — so the blast takes
// the middle segments and leaves a run at each end.
//
// THE NODE IS BELOW THE WORM, NOT ABOVE IT, and that is forced: a bolt climbs, so
// a node above the worm would sit behind a segment in the same column and
// specs/cursor.md would have the bolt strike the SEGMENT instead. Posed under,
// the bolt reaches the node first and no segment is ever shot — this point is
// about a discharge cutting a worm, never about a bolt cutting one, which is
// `worm.shot-middle-splits`.
//
// NOTHING HERE TURNS ON HOW WIDE THE CUT IS. The worm is long enough that the old
// head and the old tail survive a cut of any width the specification could be
// read as fixing, and the readings are: two worms; the piece holding the old head
// is LED by it; the other piece holds the old tail and is led from its break end.
// A build whose blast reaches a tile too far is named by
// `spares-segments-beyond-reach`, not docked a second time here.
//
// THE WORM IS POSED AS A TARGET. Its STEP faculty is off, so its tiles are where
// the scenario put them when the blast resolves; whether it winds at all is the
// `worm` category's requirement.
//
// WHAT THIS DOES NOT DECIDE. Which ID each piece carries is
// `fry-split-keeps-head-id`'s requirement, so the pieces are found here by the
// TILES they stand on and never by their ids or their roster positions.

import { afterEach, beforeEach, it } from "vitest";
import {
  BOARD_H,
  BOLT_SPEED,
  CHARGE_MAX,
  DISCHARGE_RADIUS,
} from "../constants";
import {
  assertDeepEqual,
  assertGreaterThan,
  assertLength,
  assertTrue,
} from "../assert";
import {
  captureReplay,
  createHarness,
  headOf,
  poseBolt,
  poseWorm,
  startPlaying,
  tailOf,
  ticksFor,
  type Harness,
  type WormSnapshot,
} from "../harness";

/** The row the worm lies along: clear of the entry row, the band and the edges. */
const WORM_R = 6;

/** Segments beyond the widest cut the reach could take, at each end. */
const RUN_LENGTH = 3;

/** The columns a blast of `DISCHARGE_RADIUS` covers: the `5 x 5` block's width. */
const CUT_WIDTH = 2 * DISCHARGE_RADIUS + 1;

/** A worm long enough to leave a run of `RUN_LENGTH` on each side of the cut. */
const WORM_LENGTH = CUT_WIDTH + 2 * RUN_LENGTH;

/** The head's tile. `poseWorm` lays the body behind it, descending columns. */
const HEAD_C = 20;

/** The tail's tile, `WORM_LENGTH - 1` columns behind the head. */
const TAIL_C = HEAD_C - (WORM_LENGTH - 1);

/**
 * The critical node's tile: one row below the middle segment of the chain.
 *
 * One row rather than `DISCHARGE_RADIUS`, so the cut lands on the middle of the
 * worm under any reach the specification could be read as fixing. How far the
 * blast reaches is `fries-segments-in-reach`'s requirement and
 * `spares-segments-beyond-reach`'s; what it leaves behind is this one's.
 */
const STRUCK_C = HEAD_C - (WORM_LENGTH - 1) / 2;
const STRUCK_R = WORM_R + 1;

/**
 * The most frames the bolt is given to resolve.
 *
 * specs/cursor.md flies a bolt straight up at `BOLT_SPEED` (`900` units per
 * second), so a bolt posed one tile below its target needs half a tile of climb.
 * The ceiling is the whole board's height at that speed (`640 / 900`), far past
 * what the strike needs and still bounded.
 */
const BOLT_SWEEP_TICKS = ticksFor(BOARD_H / BOLT_SPEED);

/** The worm standing on `(c, WORM_R)`, or `undefined` where no piece holds it. */
function pieceOn(
  worms: readonly WormSnapshot[],
  c: number,
): WormSnapshot | undefined {
  return worms.find((worm) =>
    worm.segments.some((seg) => seg.c === c && seg.r === WORM_R),
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
    `the worms on the board after a discharge cut the middle out of a ` +
      `${WORM_LENGTH}-segment worm`,
  );

  const headSide = pieceOn(swept.snapshot.worms, HEAD_C);
  const tailSide = pieceOn(swept.snapshot.worms, TAIL_C);
  assertDeepEqual(
    headSide === undefined ? undefined : headOf(headSide),
    { c: HEAD_C, r: WORM_R },
    "the head tile of the piece that kept the worm's old head: the first " +
      "surviving run is led by its leading segment",
  );
  assertDeepEqual(
    tailSide === undefined ? undefined : tailOf(tailSide),
    { c: TAIL_C, r: WORM_R },
    "the tail tile of the trailing piece: the run behind the break keeps the " +
      "old tail at its far end",
  );
  assertGreaterThan(
    tailSide === undefined ? Number.NaN : headOf(tailSide).c,
    TAIL_C,
    "the column of the trailing piece's own head, which must be the segment " +
      "that was nearest the break rather than the old tail",
  );
});
