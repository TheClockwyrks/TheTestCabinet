// mazing/tower-lengthens-the-route — a wall across the corridor raises the route
// the panel reports.
//
// specs/mazing.md: "The floor also carries the two vent-to-exhaust routes: the
// cheapest route, by the same rule and the same metric, from any open opening
// tile of a vent to any open opening tile of that vent's opposite exhaust. Their
// lengths are what the game reports as `paths.left.length` and
// `paths.top.length`." specs/instrumentation.md adds that `paths` is never
// `null`, because the floor can never be sealed — so a wall that lengthens a
// route shows up in its length.
//
// WHY IT TAKES A LANCE. specs/floor.md opens the left vent onto rows `16..19` and
// the right exhaust onto the same four rows, so the corridor between them is four
// tiles deep. A 2x2 or 3x3 footprint dropped on it leaves a straight lane open
// beside itself and the cheapest route is unchanged — correctly. Only the 4x4
// Lance spans the whole run, and then the route has to leave the corridor and
// come back: `49` tiles becomes `49.8284`, which is what the two diagonal steps
// out and back cost over going straight (`2 * sqrt(2) - 2`).
//
// ONE DIRECTION. This point decides only that the wall RAISES the reported
// length, to the figure the metric gives. Putting it back is
// `mazing/removing-shortens-the-route`.
//
// The guns are held off: specs/mazing.md walls the floor with a tower "whatever
// kind of tower it is", and a firing line has no part in a route length
// (specs/instrumentation.md, the firing gate).

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { LEFT_VENT_ROWS } from "../constants";
import {
  captureStill,
  createHarness,
  poseIdleTower,
  startRun,
  type Harness,
  type TowerType,
} from "../harness";
import { ventRouteLength } from "../routes";

/** The type whose 4x4 footprint spans the corridor's whole four-row run. */
const WALL_TYPE: TowerType = "lance";

/**
 * Where the wall goes: ten tiles into the floor, anchored on the corridor's
 * first row so its footprint covers all four of rows `16..19`.
 */
const WALL_COL = 10;
const WALL_ROW = LEFT_VENT_ROWS[0];

/** What the metric gives for the walled route: 49.8284 tiles. */
const WALLED_ROUTE = ventRouteLength(
  [{ type: WALL_TYPE, col: WALL_COL, row: WALL_ROW }],
  "left",
);

/**
 * How far the reported length may sit from the computed one, in tiles.
 *
 * The figure is a sum of `1`s and `sqrt(2)`s, so a conforming build differs only
 * in the last bits of a double. The bound is set by what has to stay separated:
 * the walled route is `0.8284` tiles past the open one, so a fortieth of that gap
 * keeps a build that ignored the wall apart from one that honoured it.
 */
const TOLERANCE = 0.01;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("raises paths.left.length when a wall spans the corridor", async () => {
  startRun(h);
  const open = h.snapshot().paths.left.length;

  poseIdleTower(h, WALL_TYPE, WALL_COL, WALL_ROW);
  await h.advance(1);
  captureStill(h, "longer");
  const walled = h.snapshot().paths.left.length;

  assertGreaterThan(
    walled,
    open + TOLERANCE,
    `a ${WALL_TYPE} spanning rows ${LEFT_VENT_ROWS[0]}..` +
      `${LEFT_VENT_ROWS[LEFT_VENT_ROWS.length - 1]} at column ${WALL_COL} ` +
      `lengthens the left route past the ${open} it stood at; the length ` +
      `reported with the wall up was`,
  );
  assertLessThanOrEqual(
    Math.abs(walled - WALLED_ROUTE),
    TOLERANCE,
    `the cheapest route round that wall is ${WALLED_ROUTE.toFixed(4)} tiles ` +
      `(specs/mazing.md); the build reported ${walled.toFixed(4)}, off by`,
  );
});
