// bullets/trail-follows-the-wrap — the tail follows a round over a seam.
//
// specs/weapons.md, "The bullet trail", the last bullet: "Across a wrap it
// follows the bullet to the opposite edge rather than smearing across the field,
// so no drawn part of it is further from the bullet than `TRAIL_TICKS` of the
// bullet's travel by the shortest wrapped separation." That sentence is the
// verdict, read literally: every column of the lane the round's drawing changed
// is held against the shortest wrapped distance `specs/field.md` defines, and the
// furthest of them decides the item.
//
// WHY THE READING IS OVER EVERY DRAWN COLUMN AND NOT A SAMPLE. The fault this
// item exists to catch is a tail drawn as a straight line from where the round
// stood to where it now stands, across the whole field, because the two points
// sit either side of a seam. A build with that fault paints a thousand columns of
// the lane, and a check that looked only near the round would see the same
// picture a conforming build draws and pass it. So the band is walked end to end
// and the furthest changed column is what is asserted on.
//
// THE POSE IS ARRANGED SO THE TAIL MUST STRADDLE THE SEAM. The round is placed
// `110` units short of the right edge and flown thirty ticks at `MUZZLE_SPEED`,
// which carries it `130` units: it crosses the edge and stands `20` units in from
// the left, with `78` units of tail owed behind it — so `58` of those units lie on
// the far side of the seam and there is no way to draw them without following the
// round across. The flight is longer than `TRAIL_TICKS` so the tail is full when
// it is read, and the crossing is confirmed before the verdict is taken, because
// a build that does not wrap at all has no seam for its tail to follow.
//
// THE ALLOWANCE ON THE SPAN is `20` units: the round's own disc of `BULLET_R`
// (`3`) at the head, the stroke width of a tail that is "widest and brightest
// where it meets the bullet", and the rounding of a logical unit onto a device
// column. It is a quarter of the span, and the fault it has to separate from a
// conforming tail is one that reads in the hundreds.
//
// THE LANE IS THE BOTTOM OF THE FIELD, `330` units below the star. Nothing of the
// star is drawn beyond `180` units (specs/field.md), the ship stands `130` units
// above the lane, and `startPlaying` leaves no rock and no saucer — and the
// control flight (lane.ts) is the same seeded game flown to the same tick without
// the round, so whatever else the build paints on that band is painted identically
// in both and cannot read as tail.

import { afterEach, beforeEach, it } from "vitest";
import {
  BULLET_R,
  FIELD_W,
  MUZZLE_SPEED,
  TICK_DT,
  TRAIL_TICKS,
} from "../../src/constants";
import { assertLessThan, assertLessThanOrEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { furthestDrawn, trailLane } from "./lane";

/** The lane the round is flown along, and how deep the band read along it is. */
const LANE_Y = 690;
const LANE_HALF = 4;

/** The speed the gun itself gives a round. */
const SPEED = MUZZLE_SPEED;

/** How long the round is flown for: past the seam, and past a full tail. */
const FLIGHT_TICKS = 30;

/** The travel `specs/weapons.md` gives the tail: TRAIL_TICKS of the round's motion. */
const SPAN = SPEED * TRAIL_TICKS * TICK_DT;

/** Where the round starts, so that flight leaves it just past the right seam. */
const START_X = FIELD_W - SPEED * FLIGHT_TICKS * TICK_DT + 20;

/** How far a device column must move from the bare frame to count as drawn. */
const LIT = 5;

/** What may be drawn past the span: the head's own disc and the stroke that meets it. */
const SPAN_ALLOWANCE = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps every drawn part of the tail within TRAIL_TICKS of travel of the round across a seam", async () => {
  const { pair, round } = await trailLane(
    h,
    { y: LANE_Y, halfHeight: LANE_HALF },
    { x: START_X, speed: SPEED, ticks: FLIGHT_TICKS },
  );
  // The trail carried across the seam behind the round.
  captureStill(h, "trail");

  assertLessThan(
    round.x,
    SPAN,
    `the round past the right seam and within one tail's length ` +
      `(${SPAN.toFixed(1)} units) of the left edge after ${FLIGHT_TICKS} ` +
      `ticks at ${SPEED} units per second from x = ${START_X.toFixed(1)}, so ` +
      `the tail it owes must cross the seam (specs/field.md: a body leaving ` +
      `the right edge re-enters at the left carrying its velocity)`,
  );

  const furthest = furthestDrawn(h, pair, round.x, LIT);

  assertLessThanOrEqual(
    furthest.distance,
    SPAN + SPAN_ALLOWANCE,
    `no drawn part of the round's tail further than the ${SPAN.toFixed(1)} ` +
      `units of travel TRAIL_TICKS (${TRAIL_TICKS}) ticks cover at ${SPEED} ` +
      `units per second, by shortest wrapped separation, with ` +
      `${SPAN_ALLOWANCE} units of room for the round's own disc of BULLET_R ` +
      `(${BULLET_R}) and the stroke that meets it (specs/weapons.md: across a ` +
      `wrap the tail follows the bullet to the opposite edge rather than ` +
      `smearing across the field); the furthest column the flight changed was ` +
      `at x = ${furthest.x.toFixed(1)}, with the round at ` +
      `x = ${round.x.toFixed(1)}`,
  );
});
