// bands/mismatch-spares — a shot of the opposite band never destroys.
//
// specs/bands.md, second row of the match table: "The bullet's effective band is
// the opposite | The drone is not destroyed, and the bullet is consumed". This
// point reads the first half alone — the Shard is still on the field after the
// contact — and nothing else. That the bullet is consumed is the sibling
// `bands.mismatch-consumes-bullet`, and what ELSE a mismatched shot does to the
// drone belongs to the mode this build ships (specs/mode.md) and differs between
// the two variants, so it is graded by the variant's own category. Splitting the
// rule this way is what lets this half be graded in common.
//
// THE SCENARIO IS `bands.match-destroys` WITH ONE VALUE CHANGED: the same Shard,
// the same placement, the same flight, and the opposite band on the bullet. A
// build that destroys on every contact fails here and passes there; a build that
// destroys on none fails there and passes here.
//
// THE SHOT IS PROVED TO HAVE ARRIVED. "Still standing" is only a verdict if the
// bullet actually reached the drone, so the check first reads that the shot has
// either resolved on contact or climbed clear past the target's centre. A build
// whose bullets never move would otherwise pass this point by leaving the drone
// alone for the trivial reason.
//
// No stage-clear reading is in play: this scenario destroys nothing, so the wave
// still holds its drone when the picture is kept.

import { afterEach, beforeEach, it } from "vitest";
import {
  PLAYER_BULLET_HALF,
  PLAYER_BULLET_SPEED,
  SHARD_HALF,
} from "../constants";
import { assertDefined, assertTrue } from "../assert";
import {
  LANE_CENTER,
  bulletById,
  captureStill,
  createHarness,
  droneById,
  fireAt,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";

/** Where the target stands: the posture `bands.match-destroys` uses. */
const TARGET_X = LANE_CENTER;
const TARGET_Y = 320;

/** The Shard's stored band, and the opposite one the shot carries. */
const DRONE_BAND = "cyan" as const;
const SHOT_BAND = "magenta" as const;

/**
 * How close two centres come for the circles to overlap, in logical units.
 *
 * specs/simulation.md: an overlap of two circles of the half-extents their own
 * specs state — `SHARD_HALF` (`14`) and `PLAYER_BULLET_HALF` (`6`).
 */
const TOUCHING = SHARD_HALF + PLAYER_BULLET_HALF;

/** How far below the target the shot starts: seven times the contact reach. */
const SHOT_BELOW = 7 * TOUCHING;

/**
 * Frames the flight is allowed.
 *
 * At `PLAYER_BULLET_SPEED` (`760`, specs/ship.md) a bullet covers 7.6 units per
 * frame of the harness's 100 Hz clock, so it enters the contact reach 120 units
 * up, inside 16 frames. Thirty carries a bullet that met nothing 88 units past
 * the target's centre, so by the last frame the contact has had every chance to
 * resolve and a shot that resolved on nothing is visibly clear of the drone.
 */
const FLIGHT_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves a cyan Shard standing under a magenta shot", async () => {
  startPosed(h);
  const droneId = poseDrone(h, "shard", TARGET_X, TARGET_Y, {
    band: DRONE_BAND,
  });

  const bulletId = await fireAt(
    h,
    TARGET_X,
    TARGET_Y,
    SHOT_BAND,
    SHOT_BELOW,
    FLIGHT_TICKS,
  );
  captureStill(h, "spared");

  const shot = bulletById(h.snapshot(), bulletId);
  assertTrue(
    shot === undefined || shot.y < TARGET_Y,
    `the ${SHOT_BAND} shot reaching the Shard: fired ${SHOT_BELOW} units below ` +
      `y ${TARGET_Y} and flown ${FLIGHT_TICKS} frames, it has either resolved ` +
      `on contact or climbed past the drone's centre at PLAYER_BULLET_SPEED ` +
      `${PLAYER_BULLET_SPEED} (specs/ship.md)`,
  );

  assertDefined(
    droneById(h.snapshot(), droneId),
    `the ${DRONE_BAND} Shard still on the field after a ${SHOT_BAND} bullet ` +
      `reached its ${TOUCHING}-unit contact reach (specs/bands.md)`,
  );
});
