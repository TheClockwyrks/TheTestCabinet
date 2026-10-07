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
import { OVERLOAD_AT, PLAYER_BULLET_HALF, SHARD_HALF } from "../constants";
import { assertEqual } from "../assert";
import {
  LANE_CENTER,
  captureStill,
  createHarness,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";
import { chargeById, mismatchShot, poseCharge } from "./charge";

/** Where the target Shard stands. As in `overload/mismatch-charges`. */
const TARGET_X = LANE_CENTER;
const TARGET_Y = 300;

/** The centre separation a contact needs: `SHARD_HALF` + `PLAYER_BULLET_HALF`. */
const TOUCHING = SHARD_HALF + PLAYER_BULLET_HALF;

/** How far below the target each shot starts: seven times the contact reach. */
const SHOT_BELOW = 7 * TOUCHING;

/** Frames each flight is allowed. As in `overload/charge-resets`. */
const SHOT_FRAMES = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("carries a drone that has just overloaded from zero back to one", async () => {
  startPosed(h);
  const target = poseDrone(h, "shard", TARGET_X, TARGET_Y, { band: "cyan" });
  poseCharge(h, target, OVERLOAD_AT - 1);

  const overloading = await mismatchShot(h, target, {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  assertEqual(
    overloading.hit,
    true,
    "the overloading shot resolving inside its flight",
  );
  assertEqual(
    chargeById(
      overloading.snapshot,
      target,
      "the drone that has just overloaded",
    ),
    0,
    "the charge the overload this point charges up FROM leaves behind " +
      "(specs/mode.md); `overload/charge-resets` is the point that grades it",
  );

  const again = await mismatchShot(h, target, {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  captureStill(h, "recharged");

  assertEqual(
    again.hit,
    true,
    "the second mismatched shot resolving inside its flight",
  );
  assertEqual(
    chargeById(
      again.snapshot,
      target,
      "the drone charged again after its overload",
    ),
    1,
    "the charge a mismatched shot adds to a drone that has already overloaded, " +
      "which takes charge again from 0 (specs/mode.md)",
  );
});
