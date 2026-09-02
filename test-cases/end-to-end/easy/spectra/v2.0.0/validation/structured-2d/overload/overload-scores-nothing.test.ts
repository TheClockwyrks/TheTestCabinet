// overload/overload-scores-nothing — the overloading shot pays nothing either.
//
// specs/mode.md: "A mismatched shot, AND THE SHOT THAT OVERLOADS A DRONE, each add
// nothing to the score and nothing to the resonance meter." An overload makes the
// drone more dangerous; it is not a kill, and specs/scoring.md pays for nothing
// beyond the awards it lists.
//
// THE DIRECTION THIS POINT ADDS. `overload/mismatch-scores-nothing` reads the
// ordinary charging shot; this one reads the shot that tips the drone over. A build
// that treats the overload as an event worth paying for — the reaction it triggers
// looks like a kill from the scoring path's side — pays here and not there, so the
// two grade differently.
//
// THE SCORE IS POSED AT A DISTINCTIVE NON-ZERO FIGURE for the reason that point
// gives: a build that pays and one that clears the score then read different
// numbers.
//
// THE OVERLOAD IS REAL. The drone is posed at `OVERLOAD_AT - 1` — the precondition
// — and a real mismatched shot tips it over, and the charge read back at 0 is what
// says the overload actually happened rather than the shot having been absorbed.
//
// The drone is a prop with every faculty off, so the reaction cannot carry it into
// anything else that scores, and nothing is destroyed, so no stage clears and no
// stage-clear award can reach the reading.

import { afterEach, beforeEach, it } from "vitest";
import {
  OVERLOAD_AT,
  PLAYER_BULLET_HALF,
  SHARD_HALF,
} from "../constants";
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

/** The score the run is posed at. As in `overload/mismatch-scores-nothing`. */
const POSED_SCORE = 500;

/** The centre separation a contact needs: `SHARD_HALF` + `PLAYER_BULLET_HALF`. */
const TOUCHING = SHARD_HALF + PLAYER_BULLET_HALF;

/** How far below the target the shot starts: seven times the contact reach. */
const SHOT_BELOW = 7 * TOUCHING;

/** Frames the flight is allowed. As in `overload/mismatch-scores-nothing`. */
const SHOT_FRAMES = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the score exactly where it stood when a wrong-band shot overloads a drone", async () => {
  startPosed(h);
  h.debug.setScore(POSED_SCORE);
  const target = poseDrone(h, "shard", TARGET_X, TARGET_Y, { band: "cyan" });
  poseCharge(h, target, OVERLOAD_AT - 1);

  const shot = await mismatchShot(h, target, {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  captureStill(h, "score");

  assertEqual(
    shot.hit,
    true,
    `the ${shot.band} shot resolving inside the ${String(SHOT_FRAMES)} frames ` +
      "its climb takes",
  );
  assertEqual(
    chargeById(shot.snapshot, target, "the drone that has just overloaded"),
    0,
    "the charge that says the shot really did overload the drone " +
      "(specs/mode.md); `overload/charge-resets` is the point that grades it",
  );
  assertEqual(
    shot.snapshot.score,
    POSED_SCORE,
    "the score after the shot that overloads a drone, which adds nothing to it " +
      "(specs/mode.md)",
  );
});
