// Meltdown — instrumentation/remove-tower: removeTower removes exactly one tower.
//
// specs/instrumentation.md, The towers: `removeTower(id)` "Removes that tower. Its
// footprint reopens and the routes are recomputed. It pays no refund and changes
// neither money nor score."
//
// EXACTLY ONE, AND THE FLOOR SAYS WHICH. Three towers stand on the floor and the
// middle of the three walls is taken away: the named one is gone, and the other two
// are still standing on the same footprints, at the same ids. A build whose
// `removeTower` empties the roster passes an "it is gone" reading and fails this
// one.
//
// THE FOOTPRINT IS READ THROUGH THE ROUTE, because that is where a footprint that
// is still blocked shows up. The two wall segments between them block columns `20`
// and `21` across the whole of the left corridor's rows `16` through `19`
// (specs/floor.md), so with both of them standing every route from the left vent
// has to leave the corridor; taking one away reopens two of those rows and the
// route drops back. specs/mazing.md recomputes "on the frame the set of blocked
// tiles changes", and what the reading is held against is `routes.ts`'s own
// cheapest route over the floor the snapshot reports — the specification's answer
// for the floor that is left, rather than a number the build was already holding.
//
// AND NO REFUND. specs/building.md pays one for `sellTower`, in full while the tower
// is fresh, so a build that reached for the same code path here would return the
// Arc's `15` into a purse posed at `4321`. The score is posed away from `0` for the
// same reason: `0` is where a cleared score would land anyway.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertTrue,
} from "../assert";
import {
  captureStill,
  createHarness,
  hasTower,
  poseTower,
  startRun,
  towerOf,
  type Harness,
} from "../harness";
import { routeLengths } from "../routes";
import { WALL, WALL_TYPE } from "./scenes";

/** A third tower, well away from either corridor, that the removal must not touch. */
const SPARE = { col: 6, row: 6 } as const;

/** The run figures posed, so a refund or a cleared score is observable. */
const MONEY = 4321;
const SCORE = 90210;

/**
 * How closely a reported route must match the specification's own answer, as
 * decimal places of a tile.
 *
 * Three places is `0.001` tiles. A route length is a sum of `1`s and `sqrt(2)`s
 * over a floor both sides read the same way, and the difference this reading has
 * to resolve — the detour the second wall segment was forcing — is more than two
 * whole tiles.
 */
const ROUTE_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes that tower alone, reopens its footprint, and pays no refund", async () => {
  startRun(h);
  const wall = WALL.map((at) => poseTower(h, WALL_TYPE, at.col, at.row));
  const spare = poseTower(h, WALL_TYPE, SPARE.col, SPARE.row);

  // The balance is posed AFTER the floor is built, so what this point reads is what
  // the REMOVAL did to it. What `addTower` does to the money is
  // `add-tower-costs-nothing`'s item, and a build that got that wrong must not fail
  // here as well.
  h.debug.setScore(SCORE);
  h.debug.setMoney(MONEY);
  await h.advance(1);

  const walled = h.snapshot();
  assertLength(
    walled.towers,
    wall.length + 1,
    "precondition: the floor is built",
  );

  h.debug.removeTower(wall[0]);
  await h.advance(1);
  const left = h.snapshot();
  captureStill(h, "removed");

  // The named tower is gone; the other two are standing, on their own footprints.
  assertTrue(!hasTower(left, wall[0]), "the named tower is removed");
  assertLength(left.towers, 2, "exactly one tower is removed");
  for (const id of [wall[1], spare]) {
    assertTrue(hasTower(left, id), `tower ${id} is left standing`);
  }
  assertEqual(
    towerOf(left, wall[1]).col,
    WALL[1].col,
    "the surviving wall segment keeps its footprint column",
  );
  assertEqual(
    towerOf(left, wall[1]).row,
    WALL[1].row,
    "the surviving wall segment keeps its footprint row",
  );
  assertEqual(
    towerOf(left, spare).col,
    SPARE.col,
    "the spare keeps its footprint column",
  );

  // The footprint reopened, read through the route it was lengthening.
  assertCloseTo(
    left.paths.left.length,
    routeLengths(left).left,
    ROUTE_DIGITS,
    "the left route, recomputed over the floor the removal left",
  );
  assertGreaterThan(
    walled.paths.left.length,
    left.paths.left.length,
    "the left route is shorter with the removed tower's tiles reopened",
  );

  // And nothing was paid for it.
  assertEqual(left.money, MONEY, "removeTower pays no refund into the money");
  assertEqual(left.score, SCORE, "removeTower changes no score");
});
