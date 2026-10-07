// nodes/segment-charges-nothing — a block by a worm segment raises no node's charge.
//
// specs/nodes.md: "A worm turned by the side edge of the board or by a worm
// segment changes no node's charge."
//
// WHAT MAKES THE READING SHARP. Two worms stand a tile apart on one row. The
// second is a one-segment worm on the tile the first is heading into, and its step
// faculty is off, so it is the obstacle and nothing more: specs/instrumentation.md
// has `setWormStepping` gate "the block test on the tile ahead, the charge it
// deals, the heading change, the dive it enters, and the head's advance", so the
// obstacle takes no step of its own and deals no charge of its own. The tile ahead
// of the moving head therefore holds "a tile holding a worm segment", which
// specs/worm.md names as a block, and it holds no node.
//
// Nine nodes are posed at charge `1` around the block, covering every tile of the
// three-by-four neighbourhood except the two the worms stand on and the one the
// turn takes the head into, so the rule under test is the only thing that could
// move any of them. Posed at `1` rather than `0`, every wrong model reads as its
// own number: a spurious bump reads 2, a fresh node reads 0, and a strike leaves
// the tile empty.
//
// WHAT THIS DOES NOT DECIDE. That a segment blocks and turns the worm at all is
// `worm.blocked-by-segment`'s requirement, so a build whose worms walk through one
// another is docked there rather than twice. This point reads the field alone.

import { afterEach, beforeEach, it } from "vitest";
import { wormStepInterval } from "../constants";
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

/** The moving worm's head, and the row both worms stand on. */
const WORM_C = 11;
const WORM_R = 5;

/** The stationary worm, one tile along the moving worm's heading. */
const BLOCK_C = WORM_C + 1;

/**
 * The nodes posed around the block, and the charge each one is posed at.
 *
 * Every tile of columns 10 to 13 across rows 4 to 6 except `(11, 5)` and
 * `(12, 5)`, which the two worms stand on, and `(11, 6)`, which the turn takes the
 * moving head into. What is posed is therefore the neighbourhood a build that
 * charged the wrong tile would reach into, and nothing either worm touches.
 */
const WATCHED = [
  { c: 10, r: 4 },
  { c: 11, r: 4 },
  { c: 12, r: 4 },
  { c: 13, r: 4 },
  { c: 10, r: 5 },
  { c: 13, r: 5 },
  { c: 10, r: 6 },
  { c: 12, r: 6 },
  { c: 13, r: 6 },
] as const;
const WATCHED_CHARGE = 1;

/**
 * Frames covering exactly one worm step at level 1.
 *
 * specs/worm.md clocks the worm on `wormStepInterval(level)`, which is `0.14` s
 * at level 1. Rounded up to whole frames of the 120 Hz clock that is 17 frames
 * (`0.1417` s): past one interval, and well short of the `0.28` s a second step
 * would need, so exactly one segment block happens inside the drive.
 */
const ONE_STEP_TICKS = ticksFor(wormStepInterval(1));

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves every node's charge alone when a segment turns the worm", async () => {
  startPlaying(h);
  // Rows 4 to 6 of columns 10 to 13; `.` leaves a tile as it was, which on the
  // empty board `startPlaying` poses is empty.
  poseField(h, ["1111", "1..1", "1.11"], 10, 4);

  const obstacle = poseWorm(h, BLOCK_C, WORM_R, 1, 1, 1);
  h.debug.setWormStepping(obstacle, false);
  poseWorm(h, WORM_C, WORM_R, 1, 1, 1);

  await h.advance(ONE_STEP_TICKS);
  captureStill(h, "segment");

  const after = h.snapshot();
  for (const tile of WATCHED) {
    assertEqual(
      chargeAt(after, tile.c, tile.r),
      WATCHED_CHARGE,
      `the charge on the node at (${tile.c}, ${tile.r}) after the segment block`,
    );
  }
  // And nothing was added: a build that laid a node where the segment turned it
  // would leave every watched charge alone and still have changed the field.
  assertLength(after.nodes, WATCHED.length, "the nodes on the board");
});
