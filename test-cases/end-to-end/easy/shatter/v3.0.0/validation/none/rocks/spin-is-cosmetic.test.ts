// rocks/spin-is-cosmetic — a rock's drawn rotation stays out of the simulation.
//
// `specs/rocks.md`, How a rock moves: "Each rock also carries a slow drawn rotation
// for visual life. That spin is cosmetic: it changes neither the rock's velocity nor
// its collision, so a rock under no force other than the well moves exactly along the
// path the well and its own momentum give it."
//
// WHAT A LEAK LOOKS LIKE, AND HOW IT IS READ. A rock posed at rest with the well as
// the only force on it falls straight at the star: `specs/gravity.md` directs the
// pull "along the unit vector from the body to the star's centre", so both the
// velocity it picks up and the ground it covers lie exactly on the line to the
// star's centre and have no component across it. A spin that leaks into the
// simulation is a sideways push, and it shows up as exactly that component. So the
// check reads four numbers off one second of game time: the bearing of the velocity
// and of the displacement against the bearing to the star, and the part of each
// lying across that bearing.
//
// THE ITEM IS DELIBERATELY NOT "IT STAYS WHERE IT WAS POSED". Every rock is a pulled
// body and `specs/gravity.md` fixes `MU` at `4 500 000`, so even at the field's
// furthest corner from the star a conforming rock drifts several units in a second.
// An item asserting stillness would fail every build that honours the specification,
// and gating the well to rescue the wording is worse: the well is this case's
// signature mechanic and the debug surface deliberately carries no operation that
// holds a rock out of it. What is decided here is the DIRECTION of that drift.
//
// WHERE THE ROCK STANDS. `(200, 640)`, `521` units from the star, in the field's
// lower left: clear of the star's whole drawn extent (nothing of it is drawn beyond
// `180`, `specs/field.md`), clear of the ship's safe point at `(640, 560)`, and far
// enough out that the well moves it about eight units over the second — enough for
// the bearing of the displacement to be a real reading and far too little to reach
// anything. Nothing else is on the field: `startPlaying` empties every roster and
// shuts both world gates.
//
// THE BOUNDS ARE THE REVIEW ITEM'S FIGURES — one degree, one unit per second, one
// unit. At this placement the velocity after a second is about `16.6` units per
// second, on which one degree is `0.29` units per second, so the angular bound is
// the tighter of the two and a build leaking even a slow spin into its motion fails
// it.
//
// AND THE ROCK IS REQUIRED TO HAVE MOVED AT ALL. A build that left it frozen would
// have no component across anything and would clear every bound while doing nothing
// the specification asks; `specs/gravity.md` lists "a rock, of any size" among the
// pulled bodies, so both readings are hard-asserted to exist before their direction
// is taken.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { DEG } from "../constants";
import {
  angleBetween,
  bearingOf,
  bearingTo,
  componentAcross,
  magnitude,
  shortestDelta,
  type Vec,
} from "../geometry";
import {
  captureStill,
  centreOf,
  createHarness,
  requireRock,
  startPlaying,
  ticksFor,
  velocityOf,
  type Harness,
} from "../harness";
import { STAR, poseRockAt } from "./scene";

/** Where the rock is posed: the field's lower left, 521 units from the star. */
const SPOT: Vec = { x: 200, y: 640 };

/** How long it is left alone: a second of game time, the review item's figure. */
const DRIFT_TICKS = ticksFor(1);

/** How far either bearing may lie from the star's, in degrees: the item's figure. */
const BEARING_TOLERANCE = 1;

/** How much of the velocity may lie across that bearing, in units per second. */
const SPEED_TOLERANCE = 1;

/** How much of the displacement may lie across it, in units. */
const DISTANCE_TOLERANCE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves a rock left alone straight at the star, with nothing across that line", async () => {
  await startPlaying(h);
  const id = await poseRockAt(h, "large", SPOT);
  const posed = requireRock(await h.snapshot(), id, "the rock posed at rest");

  await h.advance(DRIFT_TICKS);
  await captureStill(h, "spin");
  const drifted = requireRock(
    await h.snapshot(),
    id,
    "the rock a second of game time later",
  );

  const toStar = shortestDelta(centreOf(posed), STAR);
  const velocity = velocityOf(drifted);
  const displacement = shortestDelta(centreOf(posed), centreOf(drifted));

  // The well acted at all: a frozen rock would clear every bound below vacuously.
  assertGreaterThan(
    magnitude(velocity),
    0,
    "units per second the well gave a rock left at rest for a second (specs/gravity.md)",
  );
  assertGreaterThan(
    magnitude(displacement),
    0,
    "units the rock moved over that second (specs/gravity.md)",
  );

  // The velocity points at the star, with nothing across that line.
  assertLessThanOrEqual(
    angleBetween(bearingOf(velocity), bearingOf(toStar)) / DEG,
    BEARING_TOLERANCE,
    "degrees between the rock's velocity and the bearing to the star's centre (specs/rocks.md)",
  );
  assertLessThanOrEqual(
    Math.abs(componentAcross(velocity, toStar)),
    SPEED_TOLERANCE,
    "units per second of the rock's velocity lying ACROSS the bearing to the star (specs/rocks.md)",
  );

  // And so does the ground it covered.
  assertLessThanOrEqual(
    angleBetween(bearingOf(displacement), bearingTo(centreOf(posed), STAR)) /
      DEG,
    BEARING_TOLERANCE,
    "degrees between the rock's displacement and the bearing to the star's centre (specs/rocks.md)",
  );
  assertLessThanOrEqual(
    Math.abs(componentAcross(displacement, toStar)),
    DISTANCE_TOLERANCE,
    "units of the rock's displacement lying ACROSS the bearing to the star (specs/rocks.md)",
  );
});
