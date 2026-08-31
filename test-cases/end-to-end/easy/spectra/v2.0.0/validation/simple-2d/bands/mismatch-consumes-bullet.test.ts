// bands/mismatch-consumes-bullet — an opposite-band shot is consumed.
//
// specs/bands.md, "Your shots: match to destroy": "A mismatched shot destroys
// nothing and is consumed on contact rather than passing through", which the
// second row of that file's table states as "the bullet is consumed". This point
// reads the BULLET half of that row; `bands.mismatch-spares` reads the drone
// half. The rule holds under either mode — specs/mode.md owns what happens to the
// drone and says nothing about the bullet — so this file is graded identically
// whichever mode the build ships.
//
// THE WORLD IS ONE SHARD AND ONE SHOT, the posture `bands.mismatch-spares` uses,
// so the two points differ only in which roster they read.
//
// THE BULLET CANNOT LEAVE BY THE OTHER DOOR. specs/field.md removes a player
// bullet whose centre climbs above `FIELD_TOP` (`64`), so a check that read the
// roster too late would call that removal a consumption. The target stands at
// y 320, and `fireAt` runs only the frames `PLAYER_BULLET_SPEED` needs to cover
// the SHOT_GAP (60) below it, so a bullet that passed through is still some 250
// units short of the edge when the roster is read. {@link CLEARANCE} states that
// margin, and it is asserted rather than assumed.

import { afterEach, beforeEach, it } from "vitest";
import {
  FIELD_TOP,
  PLAYER_BULLET_SPEED,
  SHARD_HALF,
} from "../../src/constants";
import { assertNull } from "../assert";
import {
  LANE_CENTER,
  SHOT_GAP,
  captureStill,
  createHarness,
  fireAt,
  findBullet,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";

/** Where the target stands: the posture `bands.mismatch-spares` uses. */
const TARGET_X = LANE_CENTER;
const TARGET_Y = 320;

/** The Shard's stored band, and the opposite one the shot carries. */
const DRONE_BAND = "cyan" as const;
const SHOT_BAND = "magenta" as const;

/**
 * How far a bullet that passed straight through would still be from the edge
 * that removes it, in logical units.
 *
 * `fireAt` flies the shot the frames `PLAYER_BULLET_SPEED` needs to cover
 * `SHOT_GAP`, so a bullet that met nothing ends level with the target's centre,
 * `TARGET_Y - FIELD_TOP` units below the line specs/field.md removes it at. A
 * positive clearance is what makes an empty roster mean "consumed" and not "flew
 * off the top", and the failure message below states it, so a target moved nearer
 * the edge by a later edit shows up in the message rather than silently weakening
 * the check.
 */
const CLEARANCE = TARGET_Y - FIELD_TOP;

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

  const bulletId = await fireAt(h, TARGET_X, TARGET_Y, SHOT_BAND);
  captureStill(h, "consumed");

  assertNull(
    findBullet(h.snapshot(), bulletId),
    `the ${SHOT_BAND} bullet is gone from the roster after reaching the ` +
      `${DRONE_BAND} Shard's ${SHARD_HALF}-unit contact circle, having ` +
      `climbed ${SHOT_GAP} units at PLAYER_BULLET_SPEED ` +
      `${PLAYER_BULLET_SPEED} with ${CLEARANCE} units still between it and ` +
      "FIELD_TOP — specs/bands.md: a mismatched shot is consumed on contact " +
      "rather than passing through",
  );
});
