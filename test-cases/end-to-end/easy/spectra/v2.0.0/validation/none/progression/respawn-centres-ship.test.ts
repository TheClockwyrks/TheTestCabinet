// progression/respawn-centres-ship — the ship comes back at the centre of its lane.
//
// `specs/progression.md`, closing the ready hold: "When the hold ends, the ship
// reappears at the center of its lane, `(SHIP_X_MIN + SHIP_X_MAX) / 2`, holding
// the band it held."
//
// THE DISTINGUISHING POSE IS THE WHOLE CHECK. `startPosed` parks the ship at the
// centre already, so a scenario that lost a life from there would read 640 on a
// build that respawns the ship and on a build that simply leaves it where it
// died — the two are indistinguishable. So the ship is posed AWAY from the centre
// first, at a spot far from it and comfortably inside the lane's clamp, and the
// bullet is dropped down the lane wherever the ship is standing. Now each wrong
// model reads its own number: a build that centres the ship reads 640, a build
// that leaves it where it died reads the posed x, and a build that returns it to
// one end of the lane reads `SHIP_X_MIN` or `SHIP_X_MAX`.
//
// THE READING IS TAKEN ON THE FIRST FRAME THE PHASE IS `live` AGAIN, which is the
// moment the specification names, and no key is ever held, so nothing but the
// respawn can have put the ship where it is read.
//
// WHAT THIS DOES NOT DECIDE. How long the hold lasted
// (`progression/ready-hold`'s), that the ship is off the field during it, or that
// it keeps its band — this reads one number, the x it comes back at.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertCloseTo, assertEqual } from "../assert";
import {
  ENEMY_BULLET_SPEED,
  READY_HOLD,
  SHIP_X_MAX,
  SHIP_X_MIN,
  bulletSpeedScale,
  opposite,
} from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  startPosed,
  type Harness,
} from "../harness";
import { poseEnemyBulletAbove } from "./lives";

/** The centre of the ship's lane, the figure `specs/progression.md` names. */
const LANE_CENTRE = (SHIP_X_MIN + SHIP_X_MAX) / 2;

/**
 * Where the ship is posed before it is hit, in logical units.
 *
 * Well inside the lane's clamp `[SHIP_X_MIN, SHIP_X_MAX]` (`[40, 1240]`), so no
 * clamp is involved, and 340 units from `LANE_CENTRE` (`640`) — nearly seven
 * hundred times the tolerance below — so a build that leaves the ship where it
 * died is not mistaken for one that centres it.
 */
const POSED_SHIP_X = 300;

/**
 * How far the returned ship's centre may sit from `LANE_CENTRE`, in logical
 * units.
 *
 * `specs/progression.md` states an exact position, and the ship is not moving
 * when it is read, so this is a rounding allowance rather than a behaviour
 * allowance: half a logical unit is smaller than the pixel a 1280-wide stage
 * draws at 1:1.
 */
const CENTRE_TOLERANCE = 0.5;

/** How far above the ship's centre the bullet starts, in logical units. */
const DROP_ABOVE = 120;

/** The speed an enemy bullet falls at on stage 1 (`specs/stages.md`). */
const FALL_SPEED = ENEMY_BULLET_SPEED * bulletSpeedScale(1);

/** Frames the fall is given to open the hold: geometry, plus two of slack. */
const FALL_FRAMES = framesFor(DROP_ABOVE / FALL_SPEED) + 2;

/** Frames the return to `live` is given: twice `READY_HOLD` (`1.3 s`). */
const RETURN_FRAMES = framesFor(READY_HOLD * 2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts the ship back at the centre of its lane when the hold ends", async () => {
  await startPosed(h);
  // The distinguishing pose: anywhere but the centre it is required to come back
  // to.
  await h.debug.setShipX(POSED_SHIP_X);
  await h.debug.setShipContact(true);
  const posed = await h.snapshot();
  assertCloseTo(
    posed.ship.x,
    POSED_SHIP_X,
    0,
    "the ship's centre as it was posed, away from the lane's centre",
  );

  const band = opposite(posed.ship.band);
  await poseEnemyBulletAbove(h, band, DROP_ABOVE);

  const opened = await h.until((s) => s.phase === "ready", {
    maxFrames: FALL_FRAMES,
  });
  assertEqual(
    opened.hit,
    true,
    `losing a life to the ${band} bullet putting the wave into its ready ` +
      `phase, inside the ${String(FALL_FRAMES)} frames the fall takes ` +
      "(specs/progression.md)",
  );

  const returned = await h.until((s) => s.phase === "live", {
    maxFrames: RETURN_FRAMES,
  });
  await captureStill(h, "centred");
  assertEqual(
    returned.hit,
    true,
    "the wave returning to its live phase when the hold ended, inside twice " +
      "READY_HOLD (specs/progression.md) — the ship reappears at that moment",
  );
  assertBetween(
    returned.snapshot.ship.x,
    LANE_CENTRE - CENTRE_TOLERANCE,
    LANE_CENTRE + CENTRE_TOLERANCE,
    `the ship's centre on the first frame after the hold, from ` +
      `${String(POSED_SHIP_X)} where it was hit — it reappears at ` +
      `(SHIP_X_MIN + SHIP_X_MAX) / 2 = ${String(LANE_CENTRE)}, within ` +
      `${String(CENTRE_TOLERANCE)} (specs/progression.md)`,
  );
});
