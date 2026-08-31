// flight/drag-halves-in-three-seconds — an un-thrusting ship loses half its speed
// every three seconds.
//
// THE RULE. `specs/ship.md` fixes the drag as a multiplication of the velocity by
// `0.5 ^ (TICK_DT / SHIP_DRAG_HALFLIFE)` on every tick, "so an un-thrusting ship
// loses half its speed every `3.0` seconds of game time". That is the half-life,
// and it is the reading this item takes: over `SHIP_DRAG_HALFLIFE / TICK_DT`
// ticks the per-tick factor multiplies out to exactly `0.5`, whatever the tick
// rate is, so a ship posed at `400` units per second reads `200` and no
// arithmetic of the case's own stands between the specification and the bound.
//
// WHY THREE PERCENT. Six units per second on a reading of two hundred. Nothing
// conformant needs it: with no thrust there is no sub-tick ordering left to
// disagree about, and a whole tick either side of the span is 0.19 percent. What
// it leaves room for is a build whose tick clock rounds the span differently,
// while still failing every wrong half-life — `2.0` seconds reads 141, `4.0`
// reads 238, and a build with no drag at all reads the `400` it started with.
//
// WHY THE COAST IS FLOWN WHERE IT IS. Three seconds at this speed covers 865
// units, which is most of the field, so the line it is flown along is chosen to
// stay away from the middle: from `(60, 660)` at a bearing of `-45` degrees the
// ship's centre never comes within 198 units of the star's, against the `44` at
// which `specs/collision.md` has the core slide it off and change the speed being
// measured. The well itself never pulls the ship (`specs/gravity.md`), and
// `startPlaying` has emptied the field and shut both world gates, so the coast is
// the only thing happening.
//
// The facing is set along the drift so the replay reads as a coast rather than as
// a ship flying sideways. It plays no part: the drag is on the velocity, and no
// key is held.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import { DEG, SHIP_DRAG_HALFLIFE } from "../constants";
import { magnitude, scale, unitAt } from "../geometry";
import {
  captureReplay,
  createHarness,
  shipVelocity,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The speed the ship is posted at, the figure the item names. */
const COAST_SPEED = 400;

/** The bearing it coasts along: up and to the right, wide of the star. */
const COAST_BEARING = -45 * DEG;

/** Where the coast begins. See the header for why this line and not another. */
const START = { x: 60, y: 660 };

/** One half-life of game time, the span the reading is taken after. */
const COAST_TICKS = ticksFor(SHIP_DRAG_HALFLIFE);

/** Half the speed it started with, which is the whole of what the rule says. */
const EXPECTED_SPEED = COAST_SPEED / 2;

/** Three percent of that: 6 units per second. */
const SPEED_TOLERANCE = EXPECTED_SPEED * 0.03;

/** A little more of the coast, filmed after the reading, for the replay's sake. */
const SETTLED_TICKS = ticksFor(0.5);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("halves the speed of a coasting ship in one half-life", async () => {
  await startPlaying(harness);
  const drift = scale(unitAt(COAST_BEARING), COAST_SPEED);
  await harness.debug.setShipPosition(START.x, START.y);
  await harness.debug.setShipAngle(COAST_BEARING);
  await harness.debug.setShipVelocity(drift.x, drift.y);

  const coasted = await captureReplay(harness, "coast", async () => {
    await harness.advance(COAST_TICKS);
    const reading = await harness.snapshot();
    await harness.advance(SETTLED_TICKS);
    return reading;
  });

  assertLessThanOrEqual(
    Math.abs(magnitude(shipVelocity(coasted)) - EXPECTED_SPEED),
    SPEED_TOLERANCE,
    `${COAST_SPEED} units per second coasted for ${SHIP_DRAG_HALFLIFE} seconds`,
  );
});
