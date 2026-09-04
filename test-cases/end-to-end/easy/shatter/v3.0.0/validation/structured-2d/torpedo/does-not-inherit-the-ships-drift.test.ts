// torpedo/does-not-inherit-the-ships-drift — a torpedo carries none of the ship's
// motion.
//
// THE RULE. `specs/weapons.md`, "The torpedo", The launch: "It is self-propelled
// and carries NONE of the ship's drift, so its velocity at launch is
// `TORPEDO_SPEED` (`420`) along that heading AND NOTHING ELSE." That is the one
// place the torpedo and the gun differ at the muzzle: the gun's launch velocity is
// "the ship's current velocity PLUS `MUZZLE_SPEED` along the ship's facing", and
// `bullets/inherits-ship-velocity` reads that. So a build that reuses its gun's
// launch code for the torpedo fails here and nowhere else.
//
// THE DRIFT IS PUT ACROSS THE FACING, which is what makes the two models different
// numbers rather than the same one. `300` units per second at a right angle to the
// facing: a build that adds the ship's velocity reads `300` across the line, and a
// build that carries none reads `0`. Had the drift been posed ALONG the facing the
// two would differ only in the along-component, and a build that inherited would
// read `720` — still a failure, but a check posed that way would pass a build that
// inherits only the perpendicular part. Across the facing, both components are
// decisive.
//
// `300` UNITS PER SECOND IS A SPEED A PLAYER REACHES: `specs/ship.md` caps the
// ship at `SHIP_MAX` (`680`), so this is a ship under way rather than an
// impossible pose.
//
// NOTHING BUT THE LAUNCH IS IN THE READING. The velocity is read on the tick the
// press ran, and `specs/gravity.md` never pulls a torpedo, so nothing has had a
// chance to add to what the launch wrote.

import { afterEach, beforeEach, it } from "vitest";
import { DEG, SHIP_MAX, TORPEDO_SPEED } from "../constants";
import { assertLessThan, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  requireOnlyTorpedo,
  startPlaying,
  tapAction,
  type Harness,
} from "../harness";
import { TORPEDO_ACTION } from "./scenario";

/** Where the ship is posed, and which way it faces: the quiet corner, off every axis. */
const SHIP_X = 320;
const SHIP_Y = 620;
const FACING = -35 * DEG;

/** The drift the ship carries, in units per second, at a right angle to its facing. */
const DRIFT_SPEED = 300;
const DRIFT_HEADING = FACING + Math.PI / 2;

/**
 * How far either component of the launch velocity may fall from the specified
 * one, in units per second.
 *
 * 3 percent of `TORPEDO_SPEED`, which is the figure the review item states —
 * `12.6` units per second. The rule is an assignment, so a conforming build has
 * no latitude on it at all; this is room for a build that composes its velocity
 * from a unit vector and a magnitude. The wrong model it has to separate is
 * `300` units per second of inherited drift, twenty-three times this bound.
 */
const VELOCITY_TOLERANCE = 0.03 * TORPEDO_SPEED;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("launches a torpedo at TORPEDO_SPEED along the facing from a ship drifting across it", async () => {
  // A ship a player could actually be flying: the drift is well inside the cap
  // specs/ship.md sets.
  assertLessThan(
    DRIFT_SPEED,
    SHIP_MAX,
    "the posed drift to be a speed the ship can reach (specs/ship.md)",
  );

  startPlaying(h);
  h.debug.setShipPosition(SHIP_X, SHIP_Y);
  h.debug.setShipAngle(FACING);
  h.debug.setShipVelocity(
    Math.cos(DRIFT_HEADING) * DRIFT_SPEED,
    Math.sin(DRIFT_HEADING) * DRIFT_SPEED,
  );

  await tapAction(h, TORPEDO_ACTION);
  const torpedo = requireOnlyTorpedo(
    h.snapshot(),
    "one press of the torpedo key on a charged ship launches one " +
      "(torpedo/the-torpedo-action-launches-one)",
  );
  // The torpedo leaving a drifting ship on the facing alone.
  captureStill(h, "launch");

  const along = torpedo.vx * Math.cos(FACING) + torpedo.vy * Math.sin(FACING);
  const across =
    torpedo.vx * Math.cos(DRIFT_HEADING) + torpedo.vy * Math.sin(DRIFT_HEADING);

  assertLessThanOrEqual(
    Math.abs(along - TORPEDO_SPEED),
    VELOCITY_TOLERANCE,
    `the launched torpedo's velocity along the ship's facing to be ` +
      `TORPEDO_SPEED (${TORPEDO_SPEED}), within ` +
      `${VELOCITY_TOLERANCE.toFixed(1)} units per second (specs/weapons.md); ` +
      `read ${along.toFixed(1)}`,
  );
  assertLessThanOrEqual(
    Math.abs(across),
    VELOCITY_TOLERANCE,
    "the launched torpedo's velocity ACROSS the ship's facing to be 0, " +
      `within ${VELOCITY_TOLERANCE.toFixed(1)} units per second — a torpedo ` +
      "carries none of the ship's drift, and this ship was drifting at " +
      `${DRIFT_SPEED} units per second along exactly that line ` +
      `(specs/weapons.md); read ${across.toFixed(1)}`,
  );
});
