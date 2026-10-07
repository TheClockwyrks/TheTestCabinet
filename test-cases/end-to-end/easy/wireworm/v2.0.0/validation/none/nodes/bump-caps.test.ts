// nodes/bump-caps — a critical node blocked again stays critical.
//
// specs/nodes.md caps the rise at the top of the ramp:
// `charge = min(CHARGE_MAX, charge + 1)`, with CHARGE_MAX (`3`) the critical
// charge. A block against a node already there therefore leaves it at `3`; it
// does not wrap to `0`, does not climb past the cap, and is not consumed.
//
// THE POSE IS THE EDGE ITSELF. The node is posed AT CHARGE_MAX rather than
// walked up to it, so nothing but the cap is in the reading: the ramp below the
// cap is nodes/bump-climbs's requirement. One worm of one segment and one node
// stand on the board, and the drive is the single step the block happens on.
//
// specs/worm.md makes this block start a DIVE, since the head is above row
// BAND_TOP_ROW when a critical node blocks it. That is worm/dive-enters's
// requirement and is not asserted here; what is asserted is that the node the
// dive started against is still critical, which holds whichever way a build
// resolved the step.
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

/** The head's tile: above the player band, so the block is the ordinary one. */
const HEAD = { c: 10, r: 8 } as const;

/** The tile ahead of the head, holding the node the step is blocked by. */
const NODE = { c: HEAD.c + 1, r: HEAD.r } as const;

/** The node is posed at the cap, CHARGE_MAX (`3`), which specs/nodes.md calls critical. */
const POSED_CHARGE = CHARGE_MAX;

/** The drive: exactly the one step the block happens on. */
const STEPS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves a node already at CHARGE_MAX at CHARGE_MAX when it blocks again", async () => {
  await startPlaying(h);
  await h.debug.setNode(NODE.c, NODE.r, POSED_CHARGE);
  await poseWorm(h, { c: HEAD.c, r: HEAD.r, length: 1, dh: 1, dv: 1 });
  assertEqual(
    chargeAt(await h.snapshot(), NODE.c, NODE.r),
    POSED_CHARGE,
    "the node as posed, before the block",
  );

  await driveSteps(h, STEPS);
  await captureStill(h, "capped");

  assertEqual(
    chargeAt(await h.snapshot(), NODE.c, NODE.r),
    CHARGE_MAX,
    `the node at (${NODE.c}, ${NODE.r}) after blocking a second time`,
  );
});
