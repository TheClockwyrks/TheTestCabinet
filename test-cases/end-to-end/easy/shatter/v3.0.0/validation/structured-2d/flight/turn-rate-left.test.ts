// flight/turn-rate-left — the left key swings the facing counter-clockwise at
// SHIP_TURN, and a second of it is a full 300 degrees.
//
// THE RULE. `specs/ship.md`, "Inertial flight", the Rotation row: "While a turn
// key is held the facing rotates at a constant `SHIP_TURN` (`300` degrees per
// second): THE LEFT KEY TURNS COUNTER-CLOCKWISE, the right key clockwise."
// `specs/overview.md` measures angles clockwise from `+x` with `y` running down
// the screen, so counter-clockwise is the DECREASING direction and a second of
// the left key is a signed turn of `-300` degrees.
//
// WHY THE TWO DIRECTIONS ARE TWO ITEMS. A build that has one sign right and the
// other wrong — the commonest way to get this wrong — must lose exactly one
// point, so this check holds the left key and nothing else, and
// `flight/turn-rate-right` holds the right key and nothing else.
//
// WHAT IS MEASURED, AND WHY IT IS A SUM RATHER THAN A DIFFERENCE. The TOTAL
// SIGNED TURN over the second, accumulated from the facing sampled every six
// ticks (see {@link turnedThrough}). A single reading at the end could not decide
// this item at all: an angle carries no memory of how far it has been round, so
// `-300` degrees and `+60` degrees are the same reading, and `+60` is exactly
// what a build turning the WRONG WAY at a fifth of the rate would report. Summing
// the sampled steps keeps the winding, so the right answer and that wrong one are
// different numbers.
//
// AND WHY SIX TICKS IS THE RIGHT STRIDE. At the specified rate a stride of six
// ticks is a step of 15 degrees, so the unwrapping is unambiguous by a factor of
// twelve: a build would have to turn faster than 3600 degrees a second before a
// step could be read as its complement, and the only rates the sum could confuse
// with the specified one at all are `300 + 7200k` degrees a second — 24 times the
// figure and up.
//
// EVERY WRONG MODEL READS AS A DIFFERENT NUMBER. A build that turns clockwise on
// this key reads `+300` and is `600` out. A build that turns only on the press
// edge rather than for as long as the key is held — `specs/controls.md` reads
// rotation as a hold — reads `-2.5`. A build that takes `SHIP_TURN` for a rate in
// DEGREES, when `../constants` gives it in radians, reads `-5.2`. A build at
// a fifth of the rate reads `-60`. The bound is `9`.
//
// WHY 3 PERCENT IS HONEST. The review item states 3 percent of `SHIP_TURN`, which
// is 9 degrees. The rule is a constant rate over a fixed number of ticks, so the
// only latitude a conforming build has is whether the tick the key went down on
// turned — one tick is `2.5` degrees, a quarter of the bound. The rest is room
// for a build's arithmetic.
//
// THE SHIP IS AT REST AND ALONE. `startPlaying` leaves it at the safe point with
// no velocity, no key held and an empty field with both world gates shut, and a
// ship at rest is never moved by anything: the star does not pull it
// (`specs/ship.md`) and rotation itself moves nothing. So it stays `200` units
// from the star's centre for the whole second, clear of the `44` at which
// `specs/collision.md`'s slide begins, and the only system running is the one
// this point is about. That the velocity survives the turn is
// `flight/rotation-keeps-velocity`'s item, not this one.

import { afterEach, beforeEach, it } from "vitest";
import { SHIP_TURN } from "../constants";
import { assertLessThanOrEqual } from "../assert";
import { DEG } from "../geometry";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { turnedThrough } from "./motion";

/** The facing the turn starts from. Any would do; a fixed one makes the picture legible. */
const START_FACING = 0;

/** The hold the review item names: one second of game time with the key down. */
const TURN_TICKS = ticksFor(1);

/** How often the facing is sampled, in ticks: 15 degrees a step at the stated rate. */
const SAMPLE_EVERY = 6;

/**
 * The signed turn `specs/ship.md` fixes for a second of the left key, in radians.
 *
 * NEGATIVE, because angles are measured clockwise (`specs/overview.md`) and the
 * left key turns counter-clockwise.
 */
const WANTED = -SHIP_TURN;

/**
 * How far the total turn may fall from it, in radians.
 *
 * 3 percent of `SHIP_TURN`, which is the figure the review item states — 9
 * degrees, against the 2.5 a single tick of turning is worth.
 */
const TURN_TOLERANCE = 0.03 * SHIP_TURN;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("turns the facing counter-clockwise through SHIP_TURN over a second of the left key", async () => {
  startPlaying(h);
  h.debug.setShipAngle(START_FACING);

  const turned = await turnedThrough(h, "left", TURN_TICKS, SAMPLE_EVERY);
  // The ship at the end of the second, on the facing the turn left it at.
  captureStill(h, "turn");

  assertLessThanOrEqual(
    Math.abs(turned - WANTED),
    TURN_TOLERANCE,
    `the facing to have swung ${(WANTED / DEG).toFixed(0)} degrees over one ` +
      `second of the left key, within ${(TURN_TOLERANCE / DEG).toFixed(0)} — ` +
      "SHIP_TURN (300 degrees a second), counter-clockwise, which is the " +
      "decreasing direction under the field's downward y axis (specs/ship.md, " +
      `specs/overview.md); measured ${(turned / DEG).toFixed(1)} degrees as ` +
      "the sum of the sampled steps, so a turn the wrong way is not read as a " +
      "short turn the right way",
  );
});
