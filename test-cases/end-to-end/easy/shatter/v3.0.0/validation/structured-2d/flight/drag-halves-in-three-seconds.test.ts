// flight/drag-halves-in-three-seconds — a ship that stops thrusting loses half
// its speed every three seconds, on the curve the half-life fixes.
//
// THE RULE. `specs/ship.md`, "Inertial flight", the Drag row: "The velocity is
// multiplied by `0.5 ^ (TICK_DT / SHIP_DRAG_HALFLIFE)` with
// `SHIP_DRAG_HALFLIFE` (`3.0` seconds), so an un-thrusting ship loses half its
// speed every `3.0` seconds of game time." Composed over `n` ticks that is
// `0.5 ^ (t / SHIP_DRAG_HALFLIFE)` for the elapsed `t`, whatever the tick
// boundaries — see {@link keptOver} — so the specification fixes the speed at
// EVERY moment of the coast, not only at the three-second mark.
//
// WHAT IS MEASURED, AND WHY AT TWO MOMENTS RATHER THAN ONE. The coast is read
// at `SHIP_DRAG_HALFLIFE` (`3.0` s), which is the review item's own reading and
// the one whose failure states the point, and at half a half-life (`1.5` s) on
// the way. The second reading is there because THE THREE-SECOND READING ALONE
// CANNOT TELL THE CURVE FROM A STRAIGHT LINE: a build that bleeds a ship's speed
// away LINEARLY over six seconds reads exactly `200` at three seconds and passes
// a check that looks only there — while halving nothing every three seconds
// after the first, since it reaches zero at six. At `1.5` seconds the rule says
// `282.8` and that build says `300`, which is twice the bound. Both readings are
// the same sentence of the same row; posing the distinguishing moment is what
// makes a wrong model read as a different number.
//
// AND WHAT ELSE READS DIFFERENTLY. A build with no drag at all holds `400` and is
// `200` out at the three-second mark. A build that reads the half-life as a
// per-tick coefficient — `v * (1 - TICK_DT / SHIP_DRAG_HALFLIFE)`, which halves
// in `2.08` seconds rather than three — is down to `147` and is `53` out, though
// its `407.5` passes `flight/thrust-accelerates`: this is the item that catches
// it. A build that applies the whole `0.5` once a tick is at zero. The bound is
// `6.0` at the three-second mark and `8.5` at the one before it.
//
// WHY 3 PERCENT IS HONEST, AND OF WHAT. The review item states 3 percent, taken
// of the speed the rule fixes at each reading. The rule is arithmetic and a
// conforming build has almost nothing to be off by: the composition over whole
// ticks is exact, and the only latitude the specification leaves is whether the
// tick that lands on the mark has run — a single tick is `0.19` percent, a
// sixteenth of the bound. The rest is room for a build's own arithmetic.
//
// NOTHING BUT THE DRAG TOUCHES THE COAST. No key is held, so no thrust is added.
// The well never pulls the ship (`specs/ship.md`), and `startPlaying` has emptied
// the field and shut both world gates, so no rock and no saucer can arrive on top
// of the reading. The coast is flown along `y = 620`, `260` units below the
// star's row: at `400` units per second the ship covers `865` units over the
// three seconds — from `x = 100` to `x = 965`, inside the field and never wrapping
// — and stays `260` from the star's centre throughout, against the `44` at which
// `specs/collision.md`'s slide begins. The slide is the one thing that could take
// speed off a coasting ship, and it runs whether or not the lethal contact gate
// does.

import { afterEach, beforeEach, it } from "vitest";
import { SHIP_DRAG_HALFLIFE, STAR_Y } from "../constants";
import { assertCloseTo, assertLessThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { keptOver } from "./motion";

/** Where the coast is flown, and how fast: the review item's own `400` units per second. */
const SHIP_X = 100;
const SHIP_Y = 620;
const COAST_SPEED = 400;

/** How far below the star's row the coast runs, for the header's arithmetic. */
const CLEARANCE = Math.abs(SHIP_Y - STAR_Y);

/**
 * The two moments the coast is read at, in seconds of game time.
 *
 * The half-life itself, which is the review item's reading, and half of one on
 * the way, which is the moment a linearly bled build reads a different number
 * at.
 */
const READINGS: readonly number[] = [
  SHIP_DRAG_HALFLIFE / 2,
  SHIP_DRAG_HALFLIFE,
];

/**
 * How far each reading may fall from the speed the rule fixes, as a fraction.
 *
 * 3 percent, which is the figure the review item states, taken of the specified
 * speed at that reading. A single tick either way is `0.19` percent of it.
 */
const SPEED_TOLERANCE_FRACTION = 0.03;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("halves an un-thrusting ship's speed over SHIP_DRAG_HALFLIFE, on the half-life's own curve", async () => {
  startPlaying(h);
  h.debug.setShipPosition(SHIP_X, SHIP_Y);
  h.debug.setShipVelocity(COAST_SPEED, 0);

  assertCloseTo(
    h.snapshot().ship.speed,
    COAST_SPEED,
    1,
    `the ship coasting at ${String(COAST_SPEED)} units per second before the ` +
      "drag is given anything to work on (specs/instrumentation.md: " +
      "setShipVelocity)",
  );

  const readings = await captureReplay(h, "coast", async () => {
    const measured: number[] = [];
    let flown = 0;
    for (const at of READINGS) {
      const ticks = ticksFor(at);
      await h.advance(ticks - flown);
      flown = ticks;
      measured.push(h.snapshot().ship.speed);
    }
    return measured;
  });

  READINGS.forEach((at, index) => {
    const wanted = COAST_SPEED * keptOver(at);
    const tolerance = SPEED_TOLERANCE_FRACTION * wanted;
    assertLessThanOrEqual(
      Math.abs(readings[index] - wanted),
      tolerance,
      `the ship's speed at ${at.toFixed(1)} s of an un-thrusting coast within ` +
        `${tolerance.toFixed(1)} units per second of ${wanted.toFixed(1)}, ` +
        `which is ${String(COAST_SPEED)} multiplied by ` +
        `0.5 ^ (${at.toFixed(1)} / SHIP_DRAG_HALFLIFE) — the drag row of ` +
        `specs/ship.md; measured ${CLEARANCE} units clear of the star's row, ` +
        "so nothing but the drag has touched it",
    );
  });
});
