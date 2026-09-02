// progression/respawn-centres-ship — the ship comes back at the centre of its lane.
//
// specs/progression.md, closing the ready hold: "When the hold ends, the ship
// reappears at the center of its lane, `(SHIP_X_MIN + SHIP_X_MAX) / 2`, holding
// the band it held."
//
// THE DISTINGUISHING POSE IS THE WHOLE POINT. `startPosed` parks the ship at the
// centre already, so a scenario that lost a life from there would read 640 on a
// build that respawns the ship and on a build that simply leaves it where it
// died — the two would be indistinguishable. So the ship is posed AWAY from the
// centre first, at a spot far from it and comfortably inside the lane's clamp,
// and the bullet is dropped down the lane wherever the ship is standing. Now each
// wrong model reads its own number: a build that centres the ship reads 640, a
// build that leaves it where it died reads the posed x, and a build that returns
// it to one end of the lane reads `SHIP_X_MIN` (`40`) or `SHIP_X_MAX` (`1240`).
//
// THE READING IS TAKEN ON THE FIRST FRAME THE PHASE IS `live` AGAIN, which is the
// moment the specification names, and no key is ever held, so nothing but the
// respawn can have put the ship where it is read.
//
// THE LOSS IS REAL, NOT POSED, and `setShipContact(true)` puts back the one world
// gate `startPosed` shuts, because without a contact test no life is lost and
// there is no respawn to read.
//
// WHAT THIS DOES NOT DECIDE. How long the hold lasted
// (`progression.ready-hold`'s), that the ship is off the field during it
// (`screens.ready-banner`'s and `ship`'s), or that it keeps its band — this reads
// one number, the x it comes back at.

import { afterEach, beforeEach, it } from "vitest";
import {
  ENEMY_BULLET_SPEED,
  READY_HOLD,
  SHIP_X_MAX,
  SHIP_X_MIN,
  START_LIVES,
  bulletSpeedScale,
} from "../constants";
import { assertBetween, assertCloseTo, assertEqual } from "../assert";
import {
  LANE_CENTER,
  captureStill,
  createHarness,
  seconds,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { poseEnemyBulletAbove } from "./lives";

/** The band the ship holds, and the opposite one the bullet carries. */
const SHIP_BAND = "cyan" as const;
const BULLET_BAND = "magenta" as const;

/**
 * Where the ship is posed before it is hit, in logical units.
 *
 * Well inside the lane's clamp `[SHIP_X_MIN, SHIP_X_MAX]` (`[40, 1240]`), so no
 * clamp is involved, and 340 units from `LANE_CENTER` (`640`) — nearly seven
 * hundred times the tolerance below — so a build that leaves the ship where it
 * died cannot be mistaken for one that centres it.
 */
const POSED_SHIP_X = 300;

/**
 * How far the returned ship's centre may sit from `LANE_CENTER`, in logical
 * units.
 *
 * specs/progression.md states an exact position and the ship is not moving when
 * it is read, so this is a rounding allowance rather than a behaviour allowance:
 * half a logical unit is smaller than the pixel a 1280-wide stage draws at 1:1.
 */
const CENTRE_TOLERANCE = 0.5;

/** How far above the ship's centre the bullet starts, in logical units. */
const DROP_ABOVE = 120;

/** The speed an enemy bullet falls at on stage 1 (specs/stages.md). */
const FALL_SPEED = ENEMY_BULLET_SPEED * bulletSpeedScale(1);

/** Frames the fall is given to open the hold: geometry, plus two of slack. */
const FALL_TICKS = ticksFor(DROP_ABOVE / FALL_SPEED) + 2;

/** Frames the return to `live` is given: twice `READY_HOLD` (`1.3` s). */
const RETURN_TICKS = ticksFor(READY_HOLD * 2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts the ship back at the centre of its lane when the hold ends", async () => {
  startPosed(h);
  // The distinguishing pose: anywhere but the centre it has to come back to.
  h.debug.setShipX(POSED_SHIP_X);
  h.debug.setShipBand(SHIP_BAND);
  h.debug.setLives(START_LIVES);
  h.debug.setShipContact(true);
  assertCloseTo(
    h.snapshot().ship.x,
    POSED_SHIP_X,
    3,
    "the ship's centre as it was posed, away from the lane's centre",
  );

  poseEnemyBulletAbove(h, BULLET_BAND, DROP_ABOVE);

  const opened = await h.until((s) => s.phase === "ready", {
    maxFrames: FALL_TICKS,
  });
  assertEqual(
    opened.hit,
    true,
    `losing a life to a ${BULLET_BAND} bullet dropped ${DROP_ABOVE} units ` +
      `above the ship putting the wave into its ready phase inside ` +
      `${FALL_TICKS} frames (${seconds(FALL_TICKS)} s) at ENEMY_BULLET_SPEED ` +
      `${ENEMY_BULLET_SPEED} (specs/progression.md) — without the hold there ` +
      "is no respawn to read",
  );

  const returned = await h.until((s) => s.phase === "live", {
    maxFrames: RETURN_TICKS,
  });
  captureStill(h, "centred");
  assertEqual(
    returned.hit,
    true,
    "the wave returning to its live phase when the hold ended, inside " +
      `${seconds(RETURN_TICKS)} s — twice READY_HOLD ${READY_HOLD} ` +
      "(specs/progression.md). The ship reappears at that moment",
  );
  assertBetween(
    returned.snapshot.ship.x,
    LANE_CENTER - CENTRE_TOLERANCE,
    LANE_CENTER + CENTRE_TOLERANCE,
    "the ship's centre on the first frame the phase was live again, from " +
      `${POSED_SHIP_X} where it was hit — specs/progression.md: it reappears ` +
      `at (SHIP_X_MIN + SHIP_X_MAX) / 2 = (${SHIP_X_MIN} + ${SHIP_X_MAX}) / 2 ` +
      `= ${LANE_CENTER}, within ${CENTRE_TOLERANCE}. ${POSED_SHIP_X} is a ` +
      "build that left the ship where it died",
  );
});
