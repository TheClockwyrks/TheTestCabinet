// discharge/fry-leaves-no-node — a fried segment leaves nothing behind.
//
// specs/discharge.md: "A segment destroyed by a discharge leaves nothing behind:
// no node is laid on the tile it stood on." specs/nodes.md states the rule this
// is the exception to — "Every worm segment destroyed by a BOLT leaves a fresh
// node at charge `0` on the tile it died on" — so the two routes out of a segment
// differ in exactly this, and a build that runs every segment death down one path
// leaves inert nodes here and is named for it.
//
// THE TWO TILES START EMPTY OF NODES. `startPlaying` clears the field and the
// scenario lays exactly one node, the critical one the bolt strikes. So a node
// standing on either segment tile afterwards can only have been laid by the fry.
//
// THE WORM IS A VERTICAL PAIR ONE COLUMN OFF THE BLAST, so both segments sit at
// Chebyshev `1` — well inside `DISCHARGE_RADIUS` and inside a reach of `1` too.
// That is deliberate: this point is about what a fried segment LEAVES, so it must
// not turn on how far the fry reaches, which is `fries-segments-in-reach`'s
// requirement and `spares-segments-beyond-reach`'s. The pair is posed with
// `addWorm` and `appendSegment` rather than through the harness's row helper
// because the two tiles are stacked, which is the shape a worm holds after a
// drop; consecutive segments are orthogonally adjacent either way
// (specs/worm.md).
//
// NEITHER SEGMENT IS IN THE BOLT'S COLUMN, so specs/cursor.md's rule that a bolt
// resolves against the first thing in its path — and that a segment beats a node
// on a shared tile — cannot divert the strike away from the node.
//
// THE WORM IS POSED AS A TARGET. Its STEP faculty is off, so it holds the two
// tiles the reading is about instead of winding out of them.
//
// THE FRY IS GUARDED. "No node stands where the segments stood" is trivially true
// of a board whose segments were never destroyed, so the two tiles are read as
// empty of SEGMENTS first, as the scenario's precondition. That a discharge
// destroys a segment in reach at all is `fries-segments-in-reach`'s requirement.

import { afterEach, beforeEach, it } from "vitest";
import { BOARD_H, BOLT_SPEED, CHARGE_MAX } from "../../src/constants";
import { assertEqual, assertNull, assertTrue } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  lastWorm,
  poseBolt,
  segmentAt,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The tile the critical node stands on: clear of every edge and of the band. */
const STRUCK_C = 12;
const STRUCK_R = 6;

/**
 * The worm's two tiles, head first: a vertical pair in the next column along.
 *
 * Both are Chebyshev `1` from the detonation — inside the blast under any reach
 * the specification could be read as fixing — and neither is in the column the
 * bolt climbs.
 */
const SEGMENT_TILES = [
  { c: STRUCK_C + 1, r: STRUCK_R },
  { c: STRUCK_C + 1, r: STRUCK_R - 1 },
];

/**
 * The most frames the bolt is given to resolve.
 *
 * specs/cursor.md flies a bolt straight up at `BOLT_SPEED` (`900` units per
 * second), so a bolt posed one tile below its target needs half a tile of climb.
 * The ceiling is the whole board's height at that speed (`640 / 900`), far past
 * what the strike needs and still bounded.
 */
const BOLT_SWEEP_TICKS = ticksFor(BOARD_H / BOLT_SPEED);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lays no node on the tiles a discharge's fried segments stood on", async () => {
  startPlaying(h);
  h.debug.setNode(STRUCK_C, STRUCK_R, CHARGE_MAX);

  const [head, behind] = SEGMENT_TILES;
  h.debug.addWorm(head.c, head.r);
  const worm = lastWorm(h.snapshot()).id;
  h.debug.appendSegment(worm, behind.c, behind.r);
  h.debug.setWormStepping(worm, false);

  poseBolt(h, STRUCK_C, STRUCK_R + 1);

  const swept = await h.until((s) => s.bolts.length === 0, {
    maxFrames: BOLT_SWEEP_TICKS,
  });
  captureStill(h, "empty");

  assertTrue(
    swept.hit,
    "the bolt to resolve and leave flight within the sweep (specs/cursor.md)",
  );
  for (const tile of SEGMENT_TILES) {
    assertEqual(
      segmentAt(swept.snapshot, tile.c, tile.r),
      false,
      `whether a segment still stands on (${tile.c}, ${tile.r}), which is the ` +
        "scenario's precondition: a segment has to have been fried for what it " +
        "left behind to be read (graded by discharge.fries-segments-in-reach)",
    );
  }

  for (const tile of SEGMENT_TILES) {
    assertNull(
      chargeAt(swept.snapshot, tile.c, tile.r),
      `the node on (${tile.c}, ${tile.r}), where a fried segment stood: a ` +
        "segment destroyed by a discharge leaves nothing behind, unlike one " +
        "destroyed by a bolt",
    );
  }
});
