// nodes/edge-charges-nothing — a block by the side edge raises no node's charge.
//
// specs/nodes.md: "A worm turned by the side edge of the board or by a worm
// segment changes no node's charge."
//
// WHAT MAKES THE READING SHARP. The worm is posed on the last column with its
// horizontal heading pointing off the board, so the step specs/worm.md calls
// blocked is a block by the edge and by nothing else: the tile ahead is "off the
// board, which is a column outside `0` to `39`", and no node stands on it because
// no such tile exists. Four nodes are posed at charge `1` around the block — the
// tile behind the head, the tile beside the one it drops into, and two above —
// and none of them is a tile the head occupies or enters, so the rule under test
// is the only thing that could move any of them. Posed at `1` rather than `0`,
// every wrong model reads as its own number: a spurious bump reads 2, a build that
// laid a fresh node reads 0, and a build that struck one leaves the tile empty.
//
// WHAT THIS DOES NOT DECIDE. That the edge blocks the worm at all, and that the
// turn drops it a row and reverses its heading, is `worm.blocked-by-edge`'s
// requirement; a build that walks its worm off the board fails there rather than
// twice. This point reads the field alone, so it asks only what the block did to
// the node charges, and reaches a verdict on that either way.

import { afterEach, beforeEach, it } from "vitest";
import { COLS, wormStepInterval } from "../../src/constants";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  poseField,
  poseWorm,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * Where the worm stands: the last column, heading right, so its next tile is off
 * the board (specs/board.md puts the columns at `0` to `COLS - 1`).
 */
const WORM_C = COLS - 1;
const WORM_R = 5;

/**
 * The nodes posed around the block, and the charge each one is posed at.
 *
 * The head stands on `(39, 5)` and the turn takes it to `(39, 6)`, so neither
 * tile carries a node: what is posed is the neighbourhood a build that charged
 * the wrong tile would reach into, and nothing the worm itself touches.
 */
const WATCHED = [
  { c: 38, r: 4 },
  { c: 39, r: 4 },
  { c: 38, r: 5 },
  { c: 38, r: 6 },
] as const;
const WATCHED_CHARGE = 1;

/**
 * Frames covering exactly one worm step at level 1.
 *
 * specs/worm.md clocks the worm on `wormStepInterval(level)`, which is `0.14` s
 * at level 1. Rounded up to whole frames of the 120 Hz clock that is 17 frames
 * (`0.1417` s): past one interval, and well short of the `0.28` s a second step
 * would need, so exactly one edge block happens inside the drive.
 */
const ONE_STEP_TICKS = ticksFor(wormStepInterval(1));

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves every node's charge alone when the side edge turns the worm", async () => {
  startPlaying(h);
  // Rows 4 to 6 of columns 38 and 39; `.` leaves a tile as it was, which on the
  // empty board `startPlaying` poses is empty.
  poseField(h, ["11", "1.", "1."], 38, 4);
  poseWorm(h, WORM_C, WORM_R, 1, 1, 1);

  await h.advance(ONE_STEP_TICKS);
  captureStill(h, "edge");

  const after = h.snapshot();
  for (const tile of WATCHED) {
    assertEqual(
      chargeAt(after, tile.c, tile.r),
      WATCHED_CHARGE,
      `the charge on the node at (${tile.c}, ${tile.r}) after the edge block`,
    );
  }
  // And nothing was added: a build that laid a node where the edge turned it
  // would leave every watched charge alone and still have changed the field.
  assertLength(after.nodes, WATCHED.length, "the nodes on the board");
});
