// Meltdown — instrumentation/unit-motion-gate-leaves-pathing: motion off leaves the
// unit's route live.
//
// specs/instrumentation.md, The surge: `motion` gates the unit's locomotion "and
// nothing else. Off, the unit holds its position, and its route is still computed
// from the tile it stands on, so `remaining` still follows the floor and rises when
// a wall is built across its way."
//
// THE GATE IS A GATE ON ONE FACULTY, and this is the other half of it: a build that
// implemented "motion off" by taking the unit out of the simulation altogether would
// pass `unit-motion-gate` outright and fail here, because its held unit's
// `remaining` would sit at whatever it was when the unit was frozen while the floor
// changed underneath it.
//
// WHAT THE REPORTED `remaining` IS HELD AGAINST IS THE CASE'S OWN ARITHMETIC.
// `routes.ts` computes specs/mazing.md's cheapest route from the tile the unit's
// centre occupies to any open opening tile of its assigned exhaust, under the
// surge's own step rules, over the floor the snapshot reports. So the reading is the
// specification's answer for the floor as it stands, before the wall and after it,
// rather than the difference between two numbers the build was holding.
//
// AND THE UNIT MUST NOT HAVE MOVED. The rise has to be the re-path and nothing else:
// a unit that walked while the wall went up would have a different `remaining` for a
// reason that has nothing to do with the floor changing. Its position is read on both
// sides of the wall and must be the same point.
//
// THE WALL IS TWO 2x2 ANCHORS ACROSS THE LEFT CORRIDOR. specs/floor.md puts that
// corridor on rows `16` through `19`, and the pair blocks columns `20` and `21`
// across all four of them, so the straight route east that the unit was on is gone
// and the cheapest one now leaves the corridor and comes back. The floor above and
// below stays open, so nothing is sealed (specs/mazing.md, The floor can never be
// sealed) and the route the check compares against exists.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import {
  captureStill,
  createHarness,
  poseTower,
  startRun,
  unitOf,
  type Harness,
} from "../harness";
import { remainingFor } from "../routes";
import { WALK, WALL, WALL_TYPE, poseWalkerOn } from "./scenes";

/**
 * How closely a reported `remaining` must match the specification's own answer, as
 * decimal places of a tile.
 *
 * Three places is `0.001` tiles. A route length is a sum of `1`s and `sqrt(2)`s over
 * a floor both sides read the same way, so a conforming build's only slack is the
 * representation of that sum; the rise this reading has to resolve — the detour the
 * wall forces — is more than two whole tiles.
 */
const ROUTE_DIGITS = 3;

/**
 * How closely the held unit must be in the same place on both sides of the wall, in
 * logical units.
 *
 * A thousandth of a unit: with its motion held the unit takes no part in locomotion
 * at all, so there is nothing for a conforming build to move it by.
 */
const HELD_UNITS = 0.001;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("raises a held unit's remaining on the frame a wall lands across its way", async () => {
  startRun(h);
  const walker = poseWalkerOn(h, "mote", WALK.col, WALK.row);
  h.debug.setUnitMotion(walker, false);
  await h.advance(1);

  const open = h.snapshot();
  const before = unitOf(open, walker);
  assertCloseTo(
    before.remaining,
    remainingFor(open, before),
    ROUTE_DIGITS,
    "precondition: the reported remaining is the route over the open floor",
  );

  // The wall, and the one frame it lands on.
  for (const anchor of WALL) poseTower(h, WALL_TYPE, anchor.col, anchor.row);
  await h.advance(1);
  const walled = h.snapshot();
  const after = unitOf(walled, walker);
  captureStill(h, "repathed");

  // The unit is where it was: the rise is the re-path and nothing else.
  assertLessThanOrEqual(
    Math.hypot(after.x - before.x, after.y - before.y),
    HELD_UNITS,
    "logical units a held unit moved while the wall landed",
  );

  assertCloseTo(
    after.remaining,
    remainingFor(walled, after),
    ROUTE_DIGITS,
    "the reported remaining is the route over the walled floor",
  );
  assertGreaterThan(
    after.remaining,
    before.remaining,
    "tiles the wall added to a held unit's route",
  );
});
