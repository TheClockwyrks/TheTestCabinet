// torpedo/speed — a torpedo travels at 420 units per second.
//
// `specs/weapons.md`, "The flight": the Speed row is `TORPEDO_SPEED` (`420`), "held
// constant whether or not it is turning". This item reads the figure off a second
// of straight flight; `holds-speed-while-turning` reads the "held constant" half
// through a turn.
//
// WHAT IS MEASURED IS THE TRAVEL, NOT THE REPORTED VELOCITY. The distance between
// consecutive positions is what the torpedo did; `vx`/`vy` is what the build says
// it is doing. `specs/simulation.md` advances a position by one tick of velocity,
// so on a conformant build the two agree exactly, and on a build that reports one
// speed and flies at another the reading that decides the item is the one a player
// would see. Every step is summed, so the reading is the path the torpedo took
// rather than the straight line between its ends.
//
// THE TORPEDO IS PLACED RATHER THAN FIRED, AND ITS GUIDANCE IS OFF. `addTorpedo`
// puts one up "travelling at `TORPEDO_SPEED` along `heading`"
// (`specs/instrumentation.md`), which is the one operation this requirement needs —
// what the binding does is the launch items above. The guidance is the faculty this
// requirement does not exercise, so `poseStraight` shuts it; the field
// `startPlaying` leaves is empty besides, so there is nothing to acquire either way.
//
// THE LANE IS THE BOTTOM OF THE FIELD, `330` units below the star's row, and the run
// is `420` units long, so the torpedo never comes near the core and never reaches a
// seam. `specs/gravity.md` never pulls a torpedo at all, and a build that lets the
// well touch one is failing the "held constant" rule this item reads, not merely
// bending a path.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual, fail } from "../assert";
import { TICK_DT, TORPEDO_SPEED } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import {
  HEADING_RIGHT,
  LANE_X,
  LANE_Y,
  flyTorpedo,
  poseStraight,
} from "./scene";

/** How long the flight is sampled for: one second, as the manifest states. */
const FLIGHT_TICKS = ticksFor(1);

/**
 * How far the measured speed may sit from `TORPEDO_SPEED`, in units per second.
 *
 * Two per cent of `420`, the manifest's own allowance: `8.4`. It is generous against
 * the arithmetic — a position read to full float precision over `120` ticks leaves
 * nothing to round — and tight against the mistakes it exists to catch: a build
 * flying at the gun's `MUZZLE_SPEED` (`520`) reads a quarter high, and one that
 * applies its speed per FRAME rather than per tick of the `TICK_HZ` (`120`) clock
 * reads nothing like `420` either.
 */
const TOLERANCE = 0.02 * TORPEDO_SPEED;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("carries a torpedo 420 units over a second of straight flight", async () => {
  startPlaying(h);
  const id = poseStraight(h, LANE_X, LANE_Y, HEADING_RIGHT);

  const flight = await flyTorpedo(h, id, FLIGHT_TICKS);
  // A second of straight torpedo flight.
  captureStill(h, "flight");

  if (flight.ticks < FLIGHT_TICKS) {
    fail(
      "a torpedo still in flight after a second, well inside the TORPEDO_LIFE " +
        "(3.5 s) specs/weapons.md gives it on an empty field",
      `it left the roster after ${flight.ticks} ticks`,
    );
  }

  const speed = flight.distance / (flight.ticks * TICK_DT);
  assertLessThanOrEqual(
    Math.abs(speed - TORPEDO_SPEED),
    TOLERANCE,
    `the units per second a torpedo travelled over ${flight.ticks} ticks of ` +
      `straight flight, against the TORPEDO_SPEED (${TORPEDO_SPEED}) ` +
      `specs/weapons.md fixes; it covered ${flight.distance.toFixed(1)} units, a ` +
      `speed of ${speed.toFixed(2)}`,
  );
});
