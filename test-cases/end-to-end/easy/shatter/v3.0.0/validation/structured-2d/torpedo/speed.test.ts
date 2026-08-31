// torpedo/speed — a torpedo covers TORPEDO_SPEED units of field a second.
//
// THE RULE. `specs/weapons.md`, "The torpedo", The flight, the Speed row:
// "`TORPEDO_SPEED` (`420`), held constant whether or not it is turning."
//
// WHAT IS MEASURED IS THE TRAVEL, NOT THE REPORTED VELOCITY. A snapshot's `vx`
// and `vy` are what the build says the torpedo is doing; the distance between
// where it stood and where it stands a second later is what it actually did. A
// build whose velocity is right and whose integration drops or doubles a tick
// reads the specified figure in the snapshot and a different one on the field, and
// only the second reading catches it. The reported velocity is carried into the
// failure message so a reviewer can see which of the two went wrong.
//
// THE GUIDANCE IS HELD OFF, so the second of flight is straight and its length is
// the distance between its ends. `specs/instrumentation.md`:
// `setTorpedoHoming(id, false)` gates "the forward-cone acquisition and the turn
// onto a target. Off, it holds its heading. Its travel, its lifetime, and its
// impacts run on." The field is empty in any case, so nothing conforming could
// turn it — the gate is what stops a build that treats the STAR as an acquirable
// body from turning the reading into a curve. That a turning torpedo holds this
// same speed is `torpedo/holds-speed-while-turning`'s item.
//
// THE LANE IS THE BOTTOM OF THE FIELD, `y = 620`, so the whole second of flight
// stays at least `260` units from the star's centre — seven times the `36` at
// which `specs/collision.md` has the core absorb a torpedo — and the run from
// `x = 120` to `x = 540` crosses no seam, so the travel is a plain distance. The
// second is well inside `TORPEDO_LIFE` (`3.5` s), so nothing expires under the
// reading.

import { afterEach, beforeEach, it } from "vitest";
import { TORPEDO_SPEED } from "../../src/constants";
import { assertLessThanOrEqual } from "../assert";
import { speedOf, wrappedDistance } from "../geometry";
import {
  captureStill,
  createHarness,
  requireTorpedo,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { holdItsHeading, poseTorpedo, standTheShipClear } from "./scenario";

/** The lane the flight is measured along, and where on it the torpedo starts. */
const LANE_Y = 620;
const START_X = 120;
/** Along `+x`, so a whole second of travel crosses no seam. */
const HEADING = 0;

/** How long the flight is measured over, in seconds of game time. */
const FLIGHT_SECONDS = 1;
const FLIGHT_TICKS = ticksFor(FLIGHT_SECONDS);

/** What the specification says that second of flight covers, in units. */
const WANTED = TORPEDO_SPEED * FLIGHT_SECONDS;

/**
 * How far the measured travel may fall from it, in units.
 *
 * 2 percent of `TORPEDO_SPEED`, the figure the review item states — `8.4` units
 * over a second, against the `3.5` units one tick of travel is worth. The rule is
 * a constant speed over a fixed number of ticks, so the only latitude a
 * conforming build has is whether the tick the torpedo was posed on moved it,
 * which is under half this bound; the rest is room for a build's arithmetic. The
 * nearest wrong figure a build might have reached for is the gun's
 * `MUZZLE_SPEED` (`520`), `100` units away and twelve times outside it.
 */
const TRAVEL_TOLERANCE = 0.02 * TORPEDO_SPEED * FLIGHT_SECONDS;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("carries a torpedo TORPEDO_SPEED units of field over a second of straight flight", async () => {
  startPlaying(h);
  standTheShipClear(h);
  const id = poseTorpedo(h, START_X, LANE_Y, HEADING);
  holdItsHeading(h, id);

  const start = requireTorpedo(
    h.snapshot(),
    id,
    "the torpedo addTorpedo placed, before the second of flight",
  );

  await h.advance(FLIGHT_TICKS);
  const end = requireTorpedo(
    h.snapshot(),
    id,
    `the torpedo still in flight after ${FLIGHT_SECONDS} s, well inside its ` +
      "TORPEDO_LIFE and nowhere near the star's core (specs/weapons.md)",
  );
  // A second of straight torpedo flight.
  captureStill(h, "flight");

  const travelled = wrappedDistance(start, end);
  assertLessThanOrEqual(
    Math.abs(travelled - WANTED),
    TRAVEL_TOLERANCE,
    `a torpedo to cover TORPEDO_SPEED (${TORPEDO_SPEED}) units of field over ` +
      `${FLIGHT_SECONDS} second of straight flight, within ` +
      `${TRAVEL_TOLERANCE.toFixed(1)} (specs/weapons.md); it covered ` +
      `${travelled.toFixed(1)}, while reporting a velocity of ` +
      `${speedOf(end).toFixed(1)} units per second`,
  );
});
