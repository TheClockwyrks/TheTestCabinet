// flight/thrust-accelerates — a held thrust builds the speed the specification's
// own tick arithmetic produces.
//
// THE RULE. `specs/ship.md` fixes one tick of the ship as four steps in one
// order — the facing turns, an acceleration of `SHIP_THRUST` (`480` units per
// second squared) is added along the facing, the velocity is multiplied by
// `0.5 ^ (TICK_DT / SHIP_DRAG_HALFLIFE)`, and the speed is clamped to `SHIP_MAX`
// — and `specs/simulation.md` fixes `TICK_HZ` at `120`. From rest, with thrust
// held and nothing else acting, that is a geometric series and nothing else:
// after `n` ticks the speed is
//
//   SHIP_THRUST * TICK_DT * k * (1 - k^n) / (1 - k),   k = 0.5 ^ (TICK_DT / 3)
//
// which over one second comes to 428.17 — the `480` the specification names, less
// the 51.8 the half-life takes back over the same second. Nothing here is read
// off a build: the bound is the closed form of the specification's own tick. The
// cap never enters, since 428 is well under `SHIP_MAX` (`680`), which
// `flight/speed-cap` grades on its own.
//
// WHY FIVE PERCENT. Twenty-one units per second. It is the one figure this item
// can be loose about and still name a wrong model. A build that forgot the drag
// entirely reads `480`, 12.1 percent high, and fails. A build that applies the
// drag to the velocity BEFORE adding the tick's thrust rather than after reads
// 428.996, 0.19 percent high, and passes — which is right: `specs/ship.md` fixes
// the two as one tick's work in one order and nothing observable at a tick
// boundary separates them, so grading that difference would be grading an
// implementation rather than the specification. A tick either way on the key edge
// is 4 units, 0.93 percent, and fits inside the same room.
//
// WHY THE SPEED AND NOT THE COMPONENT ALONG THE FACING. This item is the SIZE of
// the acceleration; `flight/thrust-along-facing` is its DIRECTION. A build that
// thrusts the right amount in the wrong direction loses that point, not this one.
//
// WHAT ELSE COULD MOVE THE READING, AND WHY NOTHING DOES. The well never pulls
// the ship (`specs/gravity.md`); `startPlaying` empties the field and shuts both
// world gates, so no rock and no saucer arrives to be collided with; and the burn
// is flown along a row far below the star, so the ship never comes within
// `CORE_R + SHIP_R` (`44`) of its centre, where `specs/collision.md` has the core
// push it off and take the very velocity being read.

import { afterEach, beforeEach, it } from "vitest";
import { SHIP_DRAG_HALFLIFE, SHIP_THRUST, TICK_DT } from "../constants";
import { assertLessThanOrEqual } from "../assert";
import { speedOf } from "../geometry";
import {
  captureStill,
  createHarness,
  keyFor,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { holdFor } from "./drive";

/** The factor `specs/ship.md` multiplies the velocity by on every tick. */
const DRAG_PER_TICK = Math.pow(0.5, TICK_DT / SHIP_DRAG_HALFLIFE);

/** The second of held thrust the item names. */
const THRUST_TICKS = ticksFor(1);

/**
 * The speed the specification's own tick leaves after `THRUST_TICKS` of it, from
 * rest: the closed form of the series in the header, 428.17 units per second.
 */
const EXPECTED_SPEED =
  (SHIP_THRUST *
    TICK_DT *
    DRAG_PER_TICK *
    (1 - Math.pow(DRAG_PER_TICK, THRUST_TICKS))) /
  (1 - DRAG_PER_TICK);

/** Five percent of that: 21.4 units per second. See the header for the derivation. */
const SPEED_TOLERANCE = EXPECTED_SPEED * 0.05;

/**
 * Where the burn is flown from.
 *
 * A row far below the star, heading away from the field's middle: over the second
 * the ship covers about 214 units, from `(200, 600)` to `(414, 600)`, and its
 * centre stays more than 240 units from the star's — over five times the `44` at
 * which the core would touch it.
 */
const START = { x: 200, y: 600 };

/** Straight along the positive `x` axis, in radians. */
const FACE_EAST = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("builds the speed one second of thrust leaves, drag and all", async () => {
  startPlaying(h);
  h.debug.setShipPosition(START.x, START.y);
  h.debug.setShipAngle(FACE_EAST);
  h.debug.setShipVelocity(0, 0);

  await holdFor(h, keyFor("up"), THRUST_TICKS);
  const burned = h.snapshot();
  captureStill(h, "thrust");

  assertLessThanOrEqual(
    Math.abs(speedOf(burned.ship) - EXPECTED_SPEED),
    SPEED_TOLERANCE,
    `how far the speed a second of held thrust built from rest sits from the ` +
      `${EXPECTED_SPEED.toFixed(2)} units per second SHIP_THRUST leaves once ` +
      "the drag half-life has taken its share (specs/ship.md)",
  );
});
