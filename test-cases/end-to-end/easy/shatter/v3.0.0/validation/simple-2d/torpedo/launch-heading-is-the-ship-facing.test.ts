// torpedo/launch-heading-is-the-ship-facing — a torpedo leaves along the facing.
//
// `specs/weapons.md`, "The launch": a torpedo leaves the nose "with its heading set
// to the ship's facing at that moment". `specs/instrumentation.md` reports that
// heading on every torpedo, in radians, so the rule is one comparison.
//
// FOUR FACINGS, NONE OF THEM AN AXIS. `25`, `115`, `200` and `310` degrees: one in
// each quadrant, none on an axis, none the bearing from the launch spot to the
// star, and no two of them a right angle or a straight angle apart. A build that
// launches along a fixed heading fails three of the four; one that rounds the
// facing to the nearest quarter turn fails all four; one that launches along the
// ship's VELOCITY rather than its facing fails all four too, since the ship is at
// rest. Passing needs the heading to follow the facing.
//
// THE HEADINGS ARE COMPARED THE SHORT WAY ROUND, never by subtracting two angles.
// A heading names a direction and nothing in the specification fixes a range for
// it, so a build keeping headings in `[0, 2pi)` reports a launch at `-35` degrees as
// `325` — the same direction, a whole turn of apparent error. `angleGap` reads the
// same on either convention.
//
// THE FIELD IS EMPTY THROUGHOUT, so the heading read two ticks after the launch is
// still the heading it launched on: `specs/weapons.md` turns a torpedo only toward a
// candidate, and there is none. Reading it at the launch itself is impossible — the
// torpedo does not exist until the tick that made it has run.
//
// EACH LAUNCH GETS A CLEAR FIELD AND A FRESH CHARGE. `specs/weapons.md` refuses a
// launch while one torpedo is up and refuses one below full charge, so the torpedo
// from the previous facing is cleared and the charge posed full before the next
// press — the two rules the other items in this group decide, kept out of this one.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import { DEG } from "../constants";
import { angleGap, degrees } from "../geometry";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import {
  clearTorpedoes,
  poseShip,
  pressTorpedo,
  setCharge,
  theTorpedo,
} from "./scene";

/** The four facings a launch is taken at, in degrees: one to a quadrant, off every axis. */
const FACINGS_DEG = [25, 115, 200, 310] as const;

/**
 * How far a launch heading may sit from the facing, in radians.
 *
 * One degree, the manifest's own allowance. It is not room on the rule — the
 * heading IS the facing — but the honest floor for a build that stores its facing
 * as a float and reads it back through a debug surface. A build that is off by a
 * quadrant reads ninety times this.
 */
const TOLERANCE = 1 * DEG;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sets each launched torpedo's heading to the facing the ship launched it on", async () => {
  startPlaying(h);

  for (const facingDeg of FACINGS_DEG) {
    const facing = facingDeg * DEG;
    // A clear field and a full charge, so only the facing differs between launches.
    clearTorpedoes(h);
    setCharge(h, 1);
    poseShip(h, { facing });

    const launched = await pressTorpedo(h);
    const torpedo = theTorpedo(
      launched,
      `the launch taken at a facing of ${facingDeg} degrees`,
    );

    assertLessThanOrEqual(
      angleGap(torpedo.heading, facing),
      TOLERANCE,
      "the launched torpedo's heading against the ship's facing of " +
        `${facingDeg} degrees, in radians the short way round ` +
        "(specs/weapons.md: its heading is set to the ship's facing at that " +
        `moment); it read ${degrees(torpedo.heading).toFixed(3)} degrees`,
    );
  }

  // The last of the four facings a torpedo was launched at.
  captureStill(h, "facings");
});
