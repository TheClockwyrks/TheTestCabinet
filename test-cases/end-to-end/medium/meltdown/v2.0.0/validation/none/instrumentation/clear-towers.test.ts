// Meltdown — instrumentation/clear-towers: `clearTowers` empties the tower roster
// and nothing else.
//
// THE RULE. `specs/instrumentation.md`: "`clearTowers()` Removes every tower,
// reopening every footprint and recomputing the routes. It pays no refund and
// changes neither money nor score, and it leaves the surge standing."
//
// WHY THIS IS THE FIRST THING A SUITE DEPENDS ON. `startRun` — the pose under
// every one of the eighteen groups — opens by emptying both rosters, precisely so
// that a check's floor holds exactly what the check put there. A build whose
// `clearTowers` drops the towers from the roster but leaves their tiles blocked
// hands every mazing, pathing and placement check a floor with invisible walls on
// it, and the grade lands on those items rather than on this one.
//
// SO THE FLOOR IS READ, NOT THE ROSTER. An empty roster is the easy half. What
// says the footprints really reopened is the route length: two walls are built
// across the two straight vent-to-exhaust corridors, which lengthens both routes
// (`specs/mazing.md`), and after the clear both must be back at the figure the
// bare floor gave. `paths` "is never null, because the floor can never be sealed"
// (`specs/instrumentation.md`), so the reading is always there to take.
//
// NO FIGURE IS ASSERTED, ONLY A RETURN. What a bare floor's routes measure is
// `mazing/*`'s item, and how much a wall adds is too. This check reads the bare
// figure off the build's own floor BEFORE anything is built, so it asserts that
// the clear put the floor back where it found it — which is true of any
// conformant build whatever its route lengths are.
//
// THE SURGE IS THE OTHER HALF, and it is a separate reading: units on the floor
// must still be there afterwards, and must still be walking, because a build that
// cleared both rosters would satisfy the first half completely.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertDeepEqual,
  assertGreaterThan,
  assertLength,
} from "../assert";
import { LEFT_VENT_ROWS, TOP_VENT_COLS } from "../constants";
import { freeSite } from "../fixtures";
import {
  captureStill,
  createHarness,
  distance,
  framesFor,
  poseTower,
  poseWalker,
  requireUnit,
  startRun,
  type Harness,
} from "../harness";

/**
 * Where the walls stand.
 *
 * A Lance is 4x4 (`specs/towers.md`). The left vent is four rows wide and the top
 * vent eight columns (`specs/floor.md`), so one Lance lays across the whole left
 * corridor and two side by side lay across the whole top one — which is what makes
 * a detour, and so a longer route, unavoidable. This is geometry, not a threshold.
 */
const LEFT_WALL = { col: 12, row: LEFT_VENT_ROWS[0] };
const TOP_WALLS = [
  { col: TOP_VENT_COLS[0], row: 12 },
  { col: TOP_VENT_COLS[4], row: 12 },
];

/** How many units walk the floor while the towers are cleared out from under them. */
const WALKERS = 3;

/**
 * How close a route must come to the bare figure it started at, in decimal places
 * of a tile: within `5e-5`.
 *
 * A route length is a sum of whole tiles and `sqrt(2)` diagonals
 * (`specs/instrumentation.md`), and recomputing the same route over the same
 * floor is the same sum, so this is a float's representation and nothing else. A
 * footprint left blocked adds tiles, not fractions.
 */
const ROUTE_DIGITS = 4;

/** How far each walker must travel in the second after the clear, in logical units. */
const MIN_TRAVEL = 15;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes every tower, reopens the tiles they blocked and recomputes the routes", async () => {
  await startRun(h);

  // The bare floor's own figures, read before anything stands on it.
  const bare = (await h.snapshot()).paths;

  await poseTower(h, "lance", LEFT_WALL.col, LEFT_WALL.row);
  for (const wall of TOP_WALLS) await poseTower(h, "lance", wall.col, wall.row);
  const quiet = freeSite(0);
  await poseTower(h, "arc", quiet.col, quiet.row);

  const walled = await h.snapshot();
  assertLength(
    walled.towers,
    TOP_WALLS.length + 2,
    "the towers posed onto the floor",
  );
  assertGreaterThan(
    walled.paths.left.length,
    bare.left.length,
    "the wall across the left corridor lengthened the left route",
  );
  assertGreaterThan(
    walled.paths.top.length,
    bare.top.length,
    "the wall across the top corridor lengthened the top route",
  );

  await h.debug.clearTowers();
  await h.advance(1);
  await captureStill(h, "cleared");

  const cleared = await h.snapshot();
  assertLength(cleared.towers, 0, "the tower roster after clearTowers");
  assertCloseTo(
    cleared.paths.left.length,
    bare.left.length,
    ROUTE_DIGITS,
    "the left route after clearTowers, against the bare floor's",
  );
  assertCloseTo(
    cleared.paths.top.length,
    bare.top.length,
    ROUTE_DIGITS,
    "the top route after clearTowers, against the bare floor's",
  );
});

it("leaves the surge standing and walking", async () => {
  await startRun(h);
  const quiet = freeSite(0);
  await poseTower(h, "arc", quiet.col, quiet.row);
  const ids: number[] = [];
  for (let i = 0; i < WALKERS; i += 1) {
    ids.push(await poseWalker(h, "mote", i % 2 === 0 ? "left" : "top"));
  }
  await h.advance(1);
  const before = await h.snapshot();

  await h.debug.clearTowers();
  const after = await h.snapshot();

  assertLength(after.towers, 0, "the tower roster after clearTowers");
  assertDeepEqual(
    after.surge.map((unit) => unit.id),
    before.surge.map((unit) => unit.id),
    "the surge roster after clearTowers",
  );

  // And still walking: the clear took the towers, not the units' locomotion.
  await h.advance(framesFor(1));
  const driven = await h.snapshot();
  for (const id of ids) {
    assertGreaterThan(
      distance(
        requireUnit(before, id, "a unit the clear left standing"),
        requireUnit(driven, id, "a unit the clear left standing"),
      ),
      MIN_TRAVEL,
      `unit ${id} walked in the second after clearTowers`,
    );
  }
});
