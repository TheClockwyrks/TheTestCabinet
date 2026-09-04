// worm/drop-passes-through-node — the drop a block produces enters the tile
// below whatever stands on it.
//
// specs/worm.md, Winding: "Only a horizontal step can be blocked. The vertical
// move a block produces always takes the head into the tile at `(c, r + dv)`,
// whatever stands there. A node or a worm segment on that tile neither turns
// the worm nor is destroyed by it, and a node keeps the charge it had."
//
// This point reads where the head ENDED and which way it is still descending.
// What the landing node's charge is afterwards is `nodes.drop-leaves-charge`'s
// requirement, and it is deliberately not asserted here, so a build that lands
// correctly and mishandles the charge is docked once for the thing it got
// wrong.
//
// THE LANDING NODE IS POSED AT CHARGE `2`, and the value is load-bearing. It is
// the only charge from which every wrong model reads as a different number: a
// build that charged it on contact reports `3`, one that laid a fresh node over
// it reports `0`, one that let the drop eat it reports the tile empty, and one
// that detonated it leaves nothing at all — none of which can be mistaken for
// the node standing untouched. Posing it at `0` or at `3` would collapse two of
// those answers into one.
//
// THE BLOCKER'S CHARGE IS DELIBERATELY NOT `CHARGE_MAX`. A block by a critical
// node starts a dive (`worm.dive-enters`) rather than the turn whose vertical
// half this point is about.

import { afterEach, beforeEach, it } from "vitest";
import { WORM_STEP_L1 } from "../../src/constants";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseWorm,
  startPlaying,
  ticksFor,
  wormById,
  wormOn,
  type Harness,
} from "../harness";

/** Where the head is posed, the tile that blocks it, and the tile below. */
const START_C = 10;
const START_R = 5;
const BLOCKER_C = START_C + 1;
const LANDING_R = START_R + 1;

/** The blocker's charge: charged, and two bumps clear of critical. */
const BLOCKER_CHARGE = 1;

/** The landing node's charge, the value every wrong model reads differently. */
const LANDING_CHARGE = 2;

/**
 * How long the step may take before the drive gives up, in frames. Four of
 * level 1's `WORM_STEP_L1` (`0.14` s) intervals — a timeout, not a tolerance.
 */
const STEP_TIMEOUT = ticksFor(WORM_STEP_L1 * 4);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("ends the drop on the tile a node stands on, still descending", async () => {
  startPlaying(h);
  h.debug.setNode(BLOCKER_C, START_R, BLOCKER_CHARGE);
  h.debug.setNode(START_C, LANDING_R, LANDING_CHARGE);
  const id = poseWorm(h, START_C, START_R, 1, 1, 1);

  const swept = await h.until(
    (s) => wormOn(s, START_C, START_R) === undefined,
    { maxFrames: STEP_TIMEOUT, poll: 1 },
  );

  captureStill(h, "landed");

  assertEqual(
    swept.hit,
    true,
    `the head to leave (${START_C}, ${START_R}) within ${STEP_TIMEOUT} frames`,
  );
  assertDeepEqual(
    wormById(swept.snapshot, id)?.segments,
    [{ c: START_C, r: LANDING_R }],
    `the head on the tile the charge-${LANDING_CHARGE} node stands on`,
  );
  assertEqual(wormById(swept.snapshot, id)?.dv, 1, "dv, still descending");
});
