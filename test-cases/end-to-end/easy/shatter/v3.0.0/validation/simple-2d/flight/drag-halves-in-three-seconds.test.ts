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
// conformant needs it: with no thrust held there is no sub-tick ordering left for
// two builds to disagree about, and a whole tick either side of the span is 0.19
// percent. What it leaves room for is a build whose tick accumulator rounds the
// span differently, while still failing every wrong half-life — `2.0` seconds
// reads 141, `4.0` reads 238, a build applying the drag per FRAME rather than per
// tick of game time reads whatever its frame rate makes of it, and a build with
// no drag at all reads the `400` it started with.
//
// WHY THE COAST IS FLOWN WHERE IT IS. Three seconds at this speed covers 865
// units, which is most of the field, so the line it is flown along is chosen to
// stay away from the middle: from `(60, 660)` at a bearing of `-45` degrees the
// ship's centre never comes within 198 units of the star's, against the `44` at
// which `specs/collision.md` has the core slide it off and change the very speed
// being measured. The run also stays inside the field, so `specs/field.md`'s wrap
// never enters. The well itself never pulls the ship (`specs/gravity.md`), and
// `startPlaying` has emptied the field and shut both world gates, so the coast is
// the only thing happening.
//
// THE FACING IS SET ALONG THE DRIFT so the replay reads as a coast rather than as
// a ship flying sideways. It plays no part in the reading: the drag is on the
// velocity, and no key is held.

import { afterEach, beforeEach, it } from "vitest";
import { DEG, SHIP_DRAG_HALFLIFE } from "../../src/constants";
import { assertLessThanOrEqual } from "../assert";
import { speedOf } from "../geometry";
import {
  captureReplay,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The speed the ship is posed at, the figure the item names. */
const COAST_SPEED = 400;

/** The bearing it coasts along: up and to the right, wide of the star. */
const COAST_BEARING = -45 * DEG;

/** Where the coast begins. See the header for why this line and not another. */
const START = { x: 60, y: 660 };

/** One half-life of game time, the span the reading is taken after. */
const COAST_TICKS = ticksFor(SHIP_DRAG_HALFLIFE);

/** Half the speed it started with, which is the whole of what the rule says. */
const EXPECTED_SPEED = COAST_SPEED / 2;

/** Three percent of that: six units per second. See the header. */
const SPEED_TOLERANCE = EXPECTED_SPEED * 0.03;

/** A little more of the coast, filmed after the reading, for the replay's sake. */
const SETTLED_TICKS = ticksFor(0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("halves the speed of a coasting ship in one half-life", async () => {
  startPlaying(h);
  const drift = {
    vx: Math.cos(COAST_BEARING) * COAST_SPEED,
    vy: Math.sin(COAST_BEARING) * COAST_SPEED,
  };
  h.debug.setShipPosition(START.x, START.y);
  h.debug.setShipAngle(COAST_BEARING);
  h.debug.setShipVelocity(drift.vx, drift.vy);

  const coasted = await captureReplay(h, "coast", async () => {
    await h.advance(COAST_TICKS);
    const reading = h.snapshot();
    // Filmed after the reading is taken, so the replay shows the coast carrying
    // on rather than stopping on the frame the verdict was read from.
    await h.advance(SETTLED_TICKS);
    return reading;
  });

  assertLessThanOrEqual(
    Math.abs(speedOf(coasted.ship) - EXPECTED_SPEED),
    SPEED_TOLERANCE,
    `how far the speed left after ${String(SHIP_DRAG_HALFLIFE)} seconds of ` +
      `coasting from ${String(COAST_SPEED)} units per second sits from the ` +
      `${String(EXPECTED_SPEED)} the half-life leaves — an un-thrusting ship ` +
      "loses half its speed every SHIP_DRAG_HALFLIFE (specs/ship.md)",
  );
});
