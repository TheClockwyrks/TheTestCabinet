// Meltdown — instrumentation/clear-towers: clearTowers empties the towers alone.
//
// specs/instrumentation.md, The towers: `clearTowers()` "Removes every tower,
// reopening every footprint and recomputing the routes. It pays no refund and
// changes neither money nor score, and it leaves the surge standing."
//
// THE FOOTPRINTS ARE READ THROUGH THE ROUTES, because that is where a footprint
// that is still blocked shows up. specs/mazing.md makes every tower a wall and
// keeps the two vent-to-exhaust routes live — "Every route is recomputed on the
// frame the set of blocked tiles changes" — so a wall built across the left
// corridor lengthens `paths.left.length`, and a `clearTowers` that emptied the
// roster without reopening the tiles leaves that route long with no tower on the
// floor to explain it. A roster that merely reads empty is not the requirement.
//
// WHAT THE ROUTE IS HELD AGAINST IS THE CASE'S OWN ARITHMETIC. `routes.ts`
// computes specs/mazing.md's cheapest route over the floor the snapshot reports,
// under the surge's own step rules, so the reading is the specification's answer
// for the cleared floor rather than the number the build happened to hold before
// the wall went up. A build that never recomputes at all fails on the length; a
// build that recomputes against a stale floor fails on it too.
//
// AND THE SURGE IS STANDING. Three units are posed and their ids read before the
// clear; every one of them is still on the roster after it. `clearSurge` is the
// operation that empties them, and it is a different one.
//
// THE WALL IS TWO 2x2 ANCHORS ACROSS THE LEFT CORRIDOR. specs/floor.md puts that
// corridor on rows `16` through `19`, and the pair blocks columns `20` and `21`
// across all four of them, so every route from the left vent has to leave the
// corridor and come back — while the floor above and below stays open, so nothing
// is sealed (specs/mazing.md, The floor can never be sealed).

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertDeepEqual,
  assertGreaterThan,
  assertLength,
} from "../assert";
import {
  captureStill,
  createHarness,
  poseTower,
  startRun,
  type Harness,
} from "../harness";
import { routeLengths } from "../routes";
import { WALK, WALL, WALL_TYPE, poseWalkerOn } from "./scenes";

/** How many units stand on the floor while the towers are cleared. */
const BYSTANDERS = 3;

/**
 * How closely a reported route must match the specification's own answer, as
 * decimal places of a tile.
 *
 * Three places is `0.001` tiles. A route length is a sum of `1`s and `sqrt(2)`s
 * over a floor both sides read the same way, so a conforming build's only slack is
 * the representation of that sum; the difference this reading has to resolve — the
 * detour the wall forces — is more than two whole tiles.
 */
const ROUTE_DIGITS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes every tower, reopens every footprint, and leaves the surge standing", async () => {
  startRun(h);
  await h.advance(1);
  const open = h.snapshot().paths.left.length;

  // A wall across the left corridor, and three units standing on the floor.
  for (const anchor of WALL) poseTower(h, WALL_TYPE, anchor.col, anchor.row);
  const walkers: number[] = [];
  for (let i = 0; i < BYSTANDERS; i += 1) {
    walkers.push(poseWalkerOn(h, "mote", WALK.col + i * 2, WALK.row));
  }
  await h.advance(1);

  const walled = h.snapshot();
  assertLength(
    walled.towers,
    WALL.length,
    "precondition: the wall is standing",
  );
  assertGreaterThan(
    walled.paths.left.length,
    open,
    "precondition: the wall lengthens the left route",
  );

  h.debug.clearTowers();
  await h.advance(1);
  const cleared = h.snapshot();
  captureStill(h, "cleared");

  assertLength(cleared.towers, 0, "every tower is removed");

  // The footprints reopened, read through the route the wall was lengthening:
  // the specification's own cheapest route over the floor now reported.
  assertCloseTo(
    cleared.paths.left.length,
    routeLengths(cleared).left,
    ROUTE_DIGITS,
    "the left route, recomputed over the cleared floor",
  );
  assertCloseTo(
    cleared.paths.top.length,
    routeLengths(cleared).top,
    ROUTE_DIGITS,
    "the top route, recomputed over the cleared floor",
  );
  assertCloseTo(
    cleared.paths.left.length,
    open,
    ROUTE_DIGITS,
    "the left route is back to what an empty floor gives",
  );

  // And the surge is standing: the same units, by id.
  assertDeepEqual(
    cleared.surge.map((unit) => unit.id).sort((a, b) => a - b),
    [...walkers].sort((a, b) => a - b),
    "clearTowers leaves the surge standing",
  );
});
