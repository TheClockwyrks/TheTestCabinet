// overload/charge-resets — an overload puts the charge back to zero.
//
// specs/mode.md: "A mismatched shot into a drone already at `OVERLOAD_AT - 1` or
// above overloads it instead: it runs the reaction for its kind, below, and its
// charge returns to `0`." So the charge is a count of the mismatched shots taken
// SINCE THE LAST OVERLOAD, and the overload is what empties it.
//
// THE READING IS ONE NUMBER, taken in the frame the overloading shot resolved: the
// drone's charge. It separates the wrong models by the number each leaves behind —
// a build that carries the count on reads `OVERLOAD_AT` (3), one that stops the
// count at the ceiling reads `OVERLOAD_AT - 1` (2), and one that empties it reads
// 0.
//
// THE DRONE IS A PROP. It is a Shard with every faculty off, so it holds the place
// it was posed at and the only thing the shot can change about it is the charge
// this point reads. That the reaction ran at all is `overload/overloads-at-three`'s
// reading, and each kind's reaction is its own point; the charge is this one's, and
// it is the same number whichever kind takes the shot.

import { afterEach, beforeEach, it } from "vitest";
import {
  OVERLOAD_AT,
  PLAYER_BULLET_HALF,
  SHARD_HALF,
} from "../../src/constants";
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

/** How far below the target the shot starts: seven times the contact reach. */
const SHOT_BELOW = 7 * TOUCHING;

/**
 * Frames the flight is allowed.
 *
 * At `PLAYER_BULLET_SPEED` (`760`), 7.6 units per frame of the harness's 100 Hz
 * clock: the bullet enters the contact reach inside 16 frames, and thirty leaves
 * slack for whichever sub-step a build resolves the contact on.
 */
const SHOT_FRAMES = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts a drone's charge back to zero in the frame it overloads", async () => {
  startPosed(h);
  const target = poseDrone(h, "shard", TARGET_X, TARGET_Y, { band: "cyan" });
  poseCharge(h, target, OVERLOAD_AT - 1);

  assertEqual(
    chargeById(
      h.snapshot(),
      target,
      "the Shard posed one charge short of an overload",
    ),
    OVERLOAD_AT - 1,
    "the charge `setDroneCharge` poses (specs/instrumentation.md)",
  );

  const shot = await mismatchShot(h, target, {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  captureStill(h, "reset");

  assertEqual(
    shot.hit,
    true,
    `the ${shot.band} shot placed ${String(SHOT_BELOW)} units below the drone ` +
      `resolved inside the ${String(SHOT_FRAMES)} frames its climb takes`,
  );
  assertEqual(
    chargeById(shot.snapshot, target, "the drone that has just overloaded"),
    0,
    "the charge a drone carries in the frame it overloads (specs/mode.md)",
  );
});
