// torpedo/launch-heading-is-the-ship-facing — a torpedo leaves along the facing.
//
// THE RULE. `specs/weapons.md`, "The torpedo", The launch: a torpedo leaves the
// nose "with its heading set to the ship's facing AT THAT MOMENT".
// `specs/instrumentation.md` reports that heading as `torpedoes[].heading`, "its
// heading, in radians", so the reading is direct.
//
// FOUR FACINGS, ONE FROM EACH QUADRANT, and not one of them on an axis. A build
// that launches its torpedo along a fixed heading passes any single-facing check
// that happens to pose that heading; four spread facings leave it nowhere to hide.
// None is an axis, so a build that snaps the launch to the nearest of four
// directions is out by up to `25` degrees rather than landing on the answer, and
// one of them is beyond `-90` degrees so a build that keeps its headings in
// `[0, 2pi)` is read the same as one that keeps them in `(-pi, +pi]` — the
// comparison is the SHORTEST ARC between the two angles (`angleBetween`), never a
// subtraction, because a heading names a direction and the case fixes no range
// for it.
//
// EACH FACING IS ITS OWN LAUNCH, on ground `startPlaying` lays fresh: the charge
// back to full and the roster emptied, because `specs/weapons.md` allows one
// torpedo in flight at a time and refuses a launch on a spent charge. So the four
// readings are four launches rather than one launch read four ways.
//
// WHAT THIS ITEM DOES NOT DECIDE. Where the torpedo starts is
// `torpedo/launches-from-the-nose`; that its velocity is `TORPEDO_SPEED` along
// that heading with none of the ship's drift in it is
// `torpedo/does-not-inherit-the-ships-drift`. This one reads the heading alone.
//
// THE STILL IS THE LAST OF THE FOUR. `captureStill` keeps the frame currently on
// the canvas, and only one torpedo may be in flight at a time, so the picture is
// the fourth launch rather than all four at once.

import { afterEach, beforeEach, it } from "vitest";
import { DEG } from "../../src/constants";
import { assertLessThanOrEqual } from "../assert";
import { angleBetween } from "../geometry";
import {
  captureStill,
  createHarness,
  requireOnlyTorpedo,
  startPlaying,
  tapAction,
  type Harness,
} from "../harness";
import { TORPEDO_ACTION } from "./scenario";

/** Where the ship stands for every one of the four launches: the quiet corner. */
const SHIP_X = 320;
const SHIP_Y = 620;

/**
 * The four facings, in radians: one from each quadrant, none on an axis, and one
 * beyond `-90` degrees so the two angle conventions a build may keep are read the
 * same.
 */
const FACINGS = [-35 * DEG, 20 * DEG, 118 * DEG, -160 * DEG];

/**
 * How far the launch heading may fall from the facing, in radians.
 *
 * One degree, which is the figure the review item states. The rule is an
 * assignment rather than a computation — the heading IS the facing at that
 * moment — so the only latitude a conforming build has is the tick it reads the
 * facing on, and the ship is at rest and not turning, so that latitude is zero.
 * One degree is room for a build that stores its heading as a unit vector and
 * reads it back through `atan2`.
 */
const HEADING_TOLERANCE = 1 * DEG;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("launches a torpedo on the ship's facing at each of four facings", async () => {
  for (const facing of FACINGS) {
    startPlaying(h);
    h.debug.setShipPosition(SHIP_X, SHIP_Y);
    h.debug.setShipVelocity(0, 0);
    h.debug.setShipAngle(facing);

    await tapAction(h, TORPEDO_ACTION);
    const torpedo = requireOnlyTorpedo(
      h.snapshot(),
      `one press of the torpedo key on a charged ship facing ` +
        `${(facing / DEG).toFixed(0)} degrees launches one ` +
        "(torpedo/the-torpedo-action-launches-one)",
    );

    const off = angleBetween(torpedo.heading, facing);
    assertLessThanOrEqual(
      off,
      HEADING_TOLERANCE,
      "the launched torpedo's heading to be the ship's facing at that " +
        `moment, ${(facing / DEG).toFixed(0)} degrees, within ` +
        `${(HEADING_TOLERANCE / DEG).toFixed(0)} degree (specs/weapons.md); ` +
        `read ${(((torpedo.heading / DEG + 540) % 360) - 180).toFixed(2)} ` +
        `degrees, ${(off / DEG).toFixed(2)} degrees off by the shortest arc`,
    );
  }

  // The last of the four facings a torpedo was launched at.
  captureStill(h, "facings");
});
