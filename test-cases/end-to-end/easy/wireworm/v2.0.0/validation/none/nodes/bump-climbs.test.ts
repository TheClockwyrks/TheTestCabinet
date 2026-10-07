// nodes/bump-climbs — successive blocks lift one node 0 -> 1 -> 2 -> 3.
//
// specs/nodes.md fixes the rise as `charge = min(CHARGE_MAX, charge + 1)`, "once
// per block rather than continuously", and specs/nodes.md's charge table names
// `1` low, `2` charged and `3` critical. This point reads the WHOLE ramp: a
// build that lifts a node on the first block but then saturates, or one that
// jumps straight to critical, reads a different number at each rung and is named
// for the rung it missed.
//
// WHY THE WORM IS RE-POSED BETWEEN BLOCKS. specs/worm.md turns a blocked worm
// away from what blocked it — its horizontal heading reverses and its head drops
// a row — so a worm left to run bumps a DIFFERENT tile on its next step. Three
// blocks against the SAME node therefore means three approaches to it, and the
// approach is posed rather than played: the worm is cleared and laid again on the
// tile beside the node, which is the shortest route to the next block and touches
// nothing else. The node itself is never re-posed; it carries whatever the
// previous block left it at, which is the whole of what this point reads.
//
// The third block lands while the node is at charge `2`, so it is an ordinary
// block rather than the dive a CRITICAL node starts (specs/worm.md); the dive
// rule is nodes/bump-caps's scenario and worm/dive-enters's requirement.
//
// NO TOLERANCE APPLIES: a charge is a whole number and the comparison is exact.

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

/** The tile the head is laid on for each approach, clear of the band. */
const HEAD = { c: 10, r: 8 } as const;

/** The node every approach is blocked by. */
const NODE = { c: HEAD.c + 1, r: HEAD.r } as const;

/** The node starts inert, the bottom of the ramp (specs/nodes.md). */
const POSED_CHARGE = 0;

/** The ramp the blocks walk: one charge per block, capped at CHARGE_MAX. */
const CLIMB: readonly number[] = [1, 2, CHARGE_MAX];

/** Each approach drives exactly the one step its block happens on. */
const STEPS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lifts one node a single charge per block, from inert to critical", async () => {
  await startPlaying(h);
  await h.debug.setNode(NODE.c, NODE.r, POSED_CHARGE);
  assertEqual(
    chargeAt(await h.snapshot(), NODE.c, NODE.r),
    POSED_CHARGE,
    "the node as posed, before the first block",
  );

  for (const [index, expected] of CLIMB.entries()) {
    await h.debug.clearWorms();
    await poseWorm(h, { c: HEAD.c, r: HEAD.r, length: 1, dh: 1, dv: 1 });
    await driveSteps(h, STEPS);
    if (index === CLIMB.length - 1) await captureStill(h, "critical");

    assertEqual(
      chargeAt(await h.snapshot(), NODE.c, NODE.r),
      expected,
      `the node at (${NODE.c}, ${NODE.r}) after block ${index + 1}`,
    );
  }
});
