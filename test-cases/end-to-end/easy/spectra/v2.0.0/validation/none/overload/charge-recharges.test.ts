// overload/charge-recharges — a drone that has overloaded takes charge again.
//
// specs/mode.md: "A drone that has overloaded takes charge again from `0`, so it
// can be overloaded more than once." So the count is not spent once and left
// there: the shot AFTER an overload is an ordinary charging shot, and it carries
// the drone from 0 back to 1.
//
// THE OVERLOAD IS REACHED THE ONLY WAY IT CAN BE. The drone is posed at
// `OVERLOAD_AT - 1` and a real mismatched shot tips it over; then a second real
// mismatched shot is sent into the same drone. Nothing between the two poses
// anything: the drone the second shot finds is the drone the first one left.
//
// THIS IS THE DIRECTION `overload/charge-resets` CANNOT SEE. A build that empties
// the charge and then LATCHES it — refusing to count again on a drone that has
// overloaded once — reads 0 after the second shot and passes charge-resets while
// failing here. A build that never empties it reads 3 or 2 here and fails
// charge-resets as well, which is why that point is graded separately.
//
// THE DRONE IS A PROP. Every faculty is off, so the Shard the first shot overloaded
// holds the place it was posed at and the second bullet finds the same target. Its
// phase changes when it overloads — a Shard's reaction, which
// `overload/shard-plunges` grades — and specs/instrumentation.md's travel gate
// leaves it exactly where it stands while it keeps that phase.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { FORM_CENTER_X, OVERLOAD_AT } from "../constants";
import {
  captureStill,
  createHarness,
  poseDrone,
  requireDrone,
  startPosed,
  type Harness,
} from "../harness";
import { chargeOf, mismatchShot } from "./charge";

/** Where the target Shard stands. As in `overload/mismatch-charges`. */
const TARGET = { x: FORM_CENTER_X, y: 300 } as const;

/**
 * How far below the target each shot is placed, in logical units.
 *
 * Seven times the 20-unit contact reach a Shard has against one of the player's
 * bullets (`SHARD_HALF` 14 + `PLAYER_BULLET_HALF` 6).
 */
const SHOT_BELOW = 140;

/**
 * Frames each flight is allowed.
 *
 * At `PLAYER_BULLET_SPEED` (760), 7.6 units per frame of the harness's 100 Hz
 * clock: the bullet enters the contact reach inside 16 frames, and thirty leaves
 * slack for whichever frame a build resolves the contact on.
 */
const SHOT_FRAMES = 30;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("carries a drone that has just overloaded from zero back to one", async () => {
  await startPosed(harness);
  const target = await poseDrone(harness, "shard", TARGET.x, TARGET.y, {
    band: "cyan",
    charge: OVERLOAD_AT - 1,
  });

  const overloading = await mismatchShot(harness, target, {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  assertEqual(
    overloading.hit,
    true,
    "the overloading shot resolving inside its flight",
  );
  assertEqual(
    chargeOf(
      requireDrone(overloading.snapshot, target, "the drone that has just overloaded"),
      "the drone that has just overloaded",
    ),
    0,
    "the charge the overload this point charges up FROM leaves behind " +
      "(specs/mode.md); `overload/charge-resets` is the point that grades it",
  );

  const again = await mismatchShot(harness, target, {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  await captureStill(harness, "recharged");

  assertEqual(again.hit, true, "the second mismatched shot resolving inside its flight");
  assertEqual(
    chargeOf(
      requireDrone(again.snapshot, target, "the drone charged again after its overload"),
      "the drone charged again after its overload",
    ),
    1,
    "the charge a mismatched shot adds to a drone that has already overloaded, " +
      "which takes charge again from 0 (specs/mode.md)",
  );
});
