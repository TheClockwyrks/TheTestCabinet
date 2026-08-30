// nodes/bump-charges — a block by an inert node energizes it to charge 1.
//
// specs/nodes.md states the rule and the moment: "A node gains one charge when
// the worm's head is blocked by it, capped at CHARGE_MAX", and "The rise happens
// on the step the block happens, once per block rather than continuously while
// the worm touches the node." specs/worm.md makes "a tile holding a node" one of
// the three things that block a horizontal step.
//
// THE WORLD IS POSED DOWN TO THE TWO THINGS THE RULE NAMES. One worm of one
// segment, one node, and nothing else on the board: the worm carries a head
// alone, so the body's follow contributes nothing to the reading, and no second
// node exists that a build could have charged instead of this one. The drive is
// exactly the one step the block happens on, so a build that charges the node
// continuously while the worm sits against it is not given a second step to hide
// in.
//
// NO TOLERANCE APPLIES. A charge is a whole number specs/nodes.md fixes at `0`
// through CHARGE_MAX (`3`), so the reading is that number and the comparison is
// exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CHARGE_MAX } from "../constants";
import {
  captureStill,
  chargeAt,
  createHarness,
  driveSteps,
  poseWorm,
  startPlaying,
  type Harness,
} from "../harness";

/** The head's tile: well above the player band, and off the worm's entry row. */
const HEAD = { c: 10, r: 8 } as const;

/** The tile ahead of the head, which holds the node the step is blocked by. */
const NODE = { c: HEAD.c + 1, r: HEAD.r } as const;

/** The node is posed INERT, the state specs/nodes.md gives charge `0`. */
const POSED_CHARGE = 0;

/** What one block leaves: `min(CHARGE_MAX, charge + 1)` (specs/nodes.md). */
const BUMPED_CHARGE = Math.min(CHARGE_MAX, POSED_CHARGE + 1);

/** The drive: exactly the one step the block happens on. */
const STEPS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises the node that blocked the step from inert to charge 1", async () => {
  await startPlaying(h);
  await h.debug.setNode(NODE.c, NODE.r, POSED_CHARGE);
  await poseWorm(h, { c: HEAD.c, r: HEAD.r, length: 1, dh: 1, dv: 1 });
  assertEqual(
    chargeAt(await h.snapshot(), NODE.c, NODE.r),
    POSED_CHARGE,
    "the node as posed, before the block",
  );

  await driveSteps(h, STEPS);
  await captureStill(h, "bumped");

  assertEqual(
    chargeAt(await h.snapshot(), NODE.c, NODE.r),
    BUMPED_CHARGE,
    `the node at (${NODE.c}, ${NODE.r}) after one block`,
  );
});
