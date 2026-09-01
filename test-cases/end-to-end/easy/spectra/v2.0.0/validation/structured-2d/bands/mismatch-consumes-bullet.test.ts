// bands/mismatch-consumes-bullet — the opposite-band bullet is consumed.
//
// specs/bands.md, under the match table: a mismatched shot "destroys nothing and
// is consumed on contact rather than passing through". That is the bands rule
// under either mode — specs/mode.md owns only what happens to the DRONE — so this
// point is graded in common. That the drone survives is the sibling
// `bands.mismatch-spares`; nothing about the drone is read here.
//
// THE WHOLE DIFFICULTY IS TELLING "CONSUMED" FROM "LEFT THE FIELD LATER".
// specs/field.md removes a player bullet whose centre climbs above `FIELD_TOP`
// (`64`), so an empty roster only means "consumed" while the bullet is still
// under that line. The target stands at y `320` and the flight is bounded at
// {@link FLIGHT_TICKS}: a bullet that passed straight through ends 88 units above
// the target's centre and still {@link CLEARANCE} units below `FIELD_TOP`, so
// inside this sweep the only way off the roster is the contact, and a
// pass-through build is still holding its bullet when the sweep ends.

import { afterEach, beforeEach, it } from "vitest";
import {
  FIELD_TOP,
  PLAYER_BULLET_HALF,
  PLAYER_BULLET_SPEED,
  SHARD_HALF,
} from "../../src/constants";
import { assertUndefined } from "../assert";
import {
  LANE_CENTER,
  bulletById,
  captureStill,
  createHarness,
  fireAt,
  poseDrone,
  seconds,
  startPosed,
  type Harness,
} from "../harness";

/** Where the target stands: the posture `bands.mismatch-spares` uses. */
const TARGET_X = LANE_CENTER;
const TARGET_Y = 320;

/** The Shard's stored band, and the opposite one the shot carries. */
const DRONE_BAND = "cyan" as const;
const SHOT_BAND = "magenta" as const;

/** The contact reach: `SHARD_HALF` (`14`) + `PLAYER_BULLET_HALF` (`6`). */
const TOUCHING = SHARD_HALF + PLAYER_BULLET_HALF;

/** How far below the target the shot starts: seven times the contact reach. */
const SHOT_BELOW = 7 * TOUCHING;

/**
 * Frames the flight is allowed before the check calls the bullet un-consumed.
 *
 * 228 units of climb at `PLAYER_BULLET_SPEED` (`760`), 7.6 units per frame of the
 * harness's 100 Hz clock. A consumed bullet leaves the roster around frame 16;
 * one that passed through is 88 units past the target's centre and still in the
 * roster at frame 30.
 */
const FLIGHT_TICKS = 30;

/**
 * How far a bullet that passed straight through would still be from the edge that
 * removes it, in logical units.
 *
 * The climb {@link FLIGHT_TICKS} allows, measured from the shot's start, against
 * the line specs/field.md removes a player bullet at. A positive clearance is what
 * makes an empty roster mean "consumed" and not "flew off the top", and the
 * failure message states it, so a target moved nearer the edge by a later edit
 * shows up in the message rather than silently weakening the check.
 */
const CLEARANCE =
  TARGET_Y +
  SHOT_BELOW -
  seconds(FLIGHT_TICKS) * PLAYER_BULLET_SPEED -
  FIELD_TOP;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes the magenta shot off the field on contact with a cyan Shard", async () => {
  startPosed(h);
  poseDrone(h, "shard", TARGET_X, TARGET_Y, { band: DRONE_BAND });

  const bulletId = await fireAt(
    h,
    TARGET_X,
    TARGET_Y,
    SHOT_BAND,
    SHOT_BELOW,
    FLIGHT_TICKS,
  );
  captureStill(h, "consumed");

  assertUndefined(
    bulletById(h.snapshot(), bulletId),
    `the ${SHOT_BAND} bullet gone from the roster after reaching the ` +
      `${DRONE_BAND} Shard's ${TOUCHING}-unit contact reach, having climbed ` +
      `${SHOT_BELOW} units at PLAYER_BULLET_SPEED ${PLAYER_BULLET_SPEED} with ` +
      `${CLEARANCE} units still between it and FIELD_TOP (specs/bands.md)`,
  );
});
