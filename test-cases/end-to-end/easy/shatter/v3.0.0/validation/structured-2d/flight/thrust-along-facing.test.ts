// flight/thrust-along-facing — the burn pushes the ship where its nose points,
// at every facing and not only at the convenient ones.
//
// THE RULE. `specs/ship.md`, "Inertial flight", the Thrust row: "an acceleration
// of `SHIP_THRUST` (`480` units per second squared) is added ALONG THE CURRENT
// FACING." How big that acceleration is is `flight/thrust-accelerates`'s item;
// this one is the DIRECTION alone, so a build that accelerates at the wrong rate
// along the right heading keeps this point and loses that one.
//
// WHAT IS MEASURED. The heading of the velocity after a burn from rest, against
// the facing the burn was taken on, as the signed angle between them — one
// degree, which is the figure the review item states. From rest and with nothing
// else touching the ship, the specification makes the answer exact: the drag is
// a SCALAR multiplication (`specs/ship.md`) so it cannot turn a velocity, the
// well never pulls the ship at all, and the speed cap is a scalar clamp. A
// conforming build is therefore along the facing to the last bit, and the degree
// is room for a build's own arithmetic rather than room on the rule.
//
// WHY FOUR FACINGS, AND WHY THESE FOUR. One facing decides nothing: half the
// wrong models agree with the right one somewhere. So the burn is taken at four
// facings chosen so that no wrong model can read as the right one at any of
// them.
//
//   - A build that thrusts along a FIXED world axis is at least 15 degrees out at
//     every facing here, because none of the four is an axis — and 15 degrees is
//     fifteen times the bound.
//   - A build that swaps the sine and the cosine — `(sin f, cos f)` for
//     `(cos f, sin f)` — pushes along `90 - f`, which equals `f` only at 45
//     degrees and its half-turn. Neither is in the list; the smallest error the
//     four leave that build is 30 degrees.
//   - A build that takes the field's y axis as pointing UP pushes along `-f`,
//     which equals `f` only at 0 and 180 degrees. Neither is in the list; the
//     smallest error the four leave that build is 40 degrees.
//   - A build that thrusts along its VELOCITY rather than its facing has no
//     velocity to thrust along on the first tick of a burn from rest, so it
//     either never moves — which the reading below fails for having no heading
//     at all — or sets off along an axis it picked, which is the first case.
//
// EACH FACING IS ITS OWN ARRANGEMENT, POSED FROM REST. `it.each` runs the four
// as four cases over four harnesses, so a build that is right at three facings
// and wrong at one fails naming the facing it was wrong at. The velocity is
// posed to zero and read back before each burn, so the heading measured is built
// entirely by the burn and a build whose `setShipVelocity` did not take fails on
// that instead.
//
// THE BURN IS HALF A SECOND, AND IT STAYS CLEAR OF THE CORE. Half a second
// reaches about `227` units per second — a heading with no ambiguity in it — over
// `58` units of travel. From `(200, 200)` that never brings the ship within `435`
// of the star's centre, against the `44` at which `specs/collision.md`'s slide
// begins, and the slide is the one thing that could turn a velocity here since it
// runs whether or not the ship's lethal contact gate is on.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { DEG, angleDelta, headingOf } from "../geometry";
import {
  captureStill,
  createHarness,
  holdActionFor,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** Where the ship is posed for every facing: clear of the core in each direction. */
const SHIP_X = 200;
const SHIP_Y = 200;

/** The burn each facing is given, in ticks: half a second of held thrust. */
const BURN_TICKS = ticksFor(0.5);

/**
 * How far the velocity's heading may fall from the facing, in radians.
 *
 * One degree, which is the figure the review item states. The specification
 * makes the exact answer zero — the drag scales a velocity and never turns it,
 * and the well never pulls the ship — so this is room for a build's own
 * arithmetic. Every wrong model named in the header is at least 30 degrees out
 * at every facing below.
 */
const HEADING_TOLERANCE = 1 * DEG;

/**
 * The four facings the burn is taken at, in degrees.
 *
 * None is an axis, none is 45 degrees or its half-turn, and none is 0 or 180 —
 * so the axis-locked, the sine-swapped and the y-up models each read as a
 * different number at every one of them.
 */
const FACINGS: readonly number[] = [30, 115, -75, 200];

/**
 * The least speed a burn must have built for its heading to mean anything, in
 * units per second.
 *
 * Not a statement about the rate — `flight/thrust-accelerates` decides that, and
 * the specified half-second reaches about `227`. One unit per second is simply
 * the point below which `atan2` is reading rounding noise rather than a
 * direction, so a build that never thrusted is failed for having no heading
 * instead of being graded on an arbitrary one.
 */
const READABLE_SPEED = 1;

/** The facing whose frame is kept as the item's picture: the last of the four. */
const RECORDED = FACINGS[FACINGS.length - 1];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it.each(FACINGS)(
  "pushes the ship along a facing of %i degrees",
  async (degrees) => {
    const facing = degrees * DEG;

    startPlaying(h);
    h.debug.setShipPosition(SHIP_X, SHIP_Y);
    h.debug.setShipVelocity(0, 0);
    h.debug.setShipAngle(facing);

    assertCloseTo(
      h.snapshot().ship.speed,
      0,
      3,
      `the ship at rest before the burn at ${String(degrees)} degrees, so the ` +
        "heading read after it is the one the burn built alone " +
        "(specs/instrumentation.md: setShipVelocity)",
    );

    await holdActionFor(h, "up", BURN_TICKS);
    const ship = h.snapshot().ship;
    if (degrees === RECORDED) {
      // The last of the four facings, at the end of its burn.
      captureStill(h, "facings");
    }

    // A velocity of zero length has no heading, so the reading below is only
    // defined once the burn has produced one. This is not the rate — that is
    // `flight/thrust-accelerates` — only that there is a direction to measure.
    assertGreaterThan(
      ship.speed,
      READABLE_SPEED,
      `some velocity after half a second of held thrust at ` +
        `${String(degrees)} degrees, so the burn has a heading to read at all ` +
        "(specs/ship.md, specs/controls.md: thrust is read as a hold)",
    );

    assertLessThanOrEqual(
      Math.abs(angleDelta(facing, headingOf(ship))),
      HEADING_TOLERANCE,
      `the velocity's heading within one degree of the ${String(degrees)}-degree ` +
        "facing the burn was taken on — thrust is added along the current " +
        `facing (specs/ship.md); measured at ` +
        `${(headingOf(ship) / DEG).toFixed(2)} degrees`,
    );
  },
);
