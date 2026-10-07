// Meltdown — instrumentation/remove-tower: `removeTower(id)` takes that tower off
// the floor and touches nothing else.
//
// THE RULE. `specs/instrumentation.md`: "`removeTower(id)` Removes that tower. Its
// footprint reopens and the routes are recomputed. It pays no refund and changes
// neither money nor score."
//
// THE WORD UNDER TEST IS "THAT". A build whose `removeTower` clears the roster, or
// removes by index into a list a check never indexed, or reopens the whole floor,
// hands every scenario that takes one tower away a floor it did not arrange —
// and a great many of them do exactly that, because taking one wall out of a maze
// is how a route is measured against itself.
//
// SO THE FLOOR IS POSED WITH TWO WALLS AND ONE BYSTANDER, and only one wall is
// removed. Each wall lies across a different vent-to-exhaust corridor, so the two
// routes are independent readings: the removed wall's route must come back to the
// bare floor's figure and the OTHER route must stay exactly where the walls left
// it. A build that reopened every footprint passes the first reading and fails the
// second, which is the whole point of taking two.
//
// NO ROUTE FIGURE IS ASSERTED, ONLY A RETURN AND A HOLD. What a bare floor's
// routes measure, and how much a wall adds, are `mazing/*`'s items. Both readings
// here are taken against figures read off the build's own floor before anything
// was built on it.
//
// THE REFUND IS THE SECOND HALF, and it is read over an UPGRADED tower, because
// `specs/building.md` measures a refund against everything spent — build cost plus
// every upgrade — so a build that paid one out would be paying a figure far too
// large to mistake for rounding.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
} from "../assert";
import { LEFT_VENT_ROWS, MAX_LEVEL, TOP_VENT_COLS } from "../constants";
import { freeSite } from "../fixtures";
import {
  captureStill,
  createHarness,
  poseTower,
  requireTower,
  startRun,
  type Harness,
} from "../harness";

/**
 * Where the walls stand.
 *
 * A Lance is 4x4 (`specs/towers.md`); the left vent is four rows wide and the top
 * vent eight columns (`specs/floor.md`), so one Lance lays across the whole left
 * corridor and two side by side lay across the whole top one. Geometry, not a
 * threshold.
 */
const LEFT_WALL = { col: 12, row: LEFT_VENT_ROWS[0] };
const TOP_WALLS = [
  { col: TOP_VENT_COLS[0], row: 12 },
  { col: TOP_VENT_COLS[4], row: 12 },
];

/**
 * How close a route must come to the figure it is held to, in decimal places of a
 * tile: within `5e-5`.
 *
 * A route length is a sum of whole tiles and `sqrt(2)` diagonals
 * (`specs/instrumentation.md`), so recomputing the same route over the same floor
 * is the same sum and this is a float's representation and nothing else.
 */
const ROUTE_DIGITS = 6;

/** Money posed so the upgrades in the second reading land. A precondition. */
const AMPLE_MONEY = 100_000;
/** A score posed to something no accident could produce. */
const POSED_SCORE = 6821;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes that tower alone, reopening its footprint and no other", async () => {
  await startRun(h);
  const bare = (await h.snapshot()).paths;

  const removed = await poseTower(h, "lance", LEFT_WALL.col, LEFT_WALL.row);
  const kept: number[] = [];
  for (const wall of TOP_WALLS) {
    kept.push(await poseTower(h, "lance", wall.col, wall.row));
  }
  const quiet = freeSite(0);
  kept.push(await poseTower(h, "arc", quiet.col, quiet.row));

  const walled = await h.snapshot();
  assertGreaterThan(
    walled.paths.left.length,
    bare.left.length,
    "the wall across the left corridor lengthened the left route",
  );
  assertGreaterThan(
    walled.paths.top.length,
    bare.top.length,
    "the walls across the top corridor lengthened the top route",
  );

  await h.debug.removeTower(removed);
  await h.advance(1);
  await captureStill(h, "removed");

  const after = await h.snapshot();
  assertDeepEqual(
    after.towers.map((tower) => tower.id),
    kept,
    "the tower roster after removeTower",
  );
  assertCloseTo(
    after.paths.left.length,
    bare.left.length,
    ROUTE_DIGITS,
    "the left route after the wall on it was removed",
  );
  assertCloseTo(
    after.paths.top.length,
    walled.paths.top.length,
    ROUTE_DIGITS,
    "the top route after a wall on the OTHER corridor was removed",
  );
});

it("pays no refund for an upgraded tower", async () => {
  await startRun(h);
  await h.debug.setMoney(AMPLE_MONEY);
  await h.debug.setScore(POSED_SCORE);

  const site = freeSite(0);
  const id = await poseTower(h, "lance", site.col, site.row);
  for (let level = 1; level < MAX_LEVEL; level += 1) {
    await h.debug.upgradeTower(id);
  }
  const before = await h.snapshot();
  assertGreaterThan(
    requireTower(before, id, "the upgraded Lance").refund,
    0,
    "the tower was worth something to sell when it was removed",
  );

  await h.debug.removeTower(id);
  const after = await h.snapshot();
  assertLength(after.towers, 0, "the tower roster after removeTower");
  assertEqual(after.money, before.money, "the money removeTower left");
  assertEqual(after.score, before.score, "the score removeTower left");
});
