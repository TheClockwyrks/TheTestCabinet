// mazing/removing-shortens-the-route — taking the wall away puts the route back.
//
// specs/mazing.md: "Every route is recomputed on the frame the set of blocked
// tiles changes: a tower placed, a tower sold, or a tower otherwise added to or
// removed from the floor." specs/instrumentation.md says the same of the
// operation used here: `removeTower` "removes that tower", and its footprint is
// no longer part of the blocked set the routes are computed over.
//
// ONE DIRECTION, AND WHICH ONE. This point decides the RESTORATION and nothing
// else: that after the wall is gone the reported length is back at the figure an
// unblocked corridor gives. That the wall lengthened it in the first place is
// `mazing/tower-lengthens-the-route`, and a build that blocks nothing at all is
// caught there rather than here — the two items therefore grade a never-blocks
// build and a never-reopens build differently, which is what keeping them apart
// is for.
//
// Both the reading before the wall and the reading after it are held to the
// figure the metric gives for an unblocked floor, `49` tiles (specs/floor.md puts
// the left vent's four rows opposite the right exhaust's four, so the corridor is
// a straight run of 49 orthogonal steps), and to each other. A build that
// reopened the footprint but rebuilt the route from a stale blocked set fails the
// pair.
//
// The wall is the 4x4 Lance because it is the only footprint that spans the
// corridor's four-row run; anything narrower leaves a straight lane open beside
// it and there is nothing to restore. Its guns are held off, because walling is
// the only faculty this requirement exercises.

import { afterEach, beforeEach, it } from "vitest";
import { LEFT_VENT_ROWS } from "../constants";
import { assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseIdleTower,
  startRun,
  type Harness,
  type TowerType,
} from "../harness";
import { ventRouteLength } from "./routes";

/** The type whose 4x4 footprint spans the corridor's whole four-row run. */
const WALL_TYPE: TowerType = "lance";

/** Where the wall goes: ten tiles in, anchored on the corridor's first row. */
const WALL_COL = 10;
const WALL_ROW = LEFT_VENT_ROWS[0];

/** What the metric gives for an unblocked left corridor: 49 tiles. */
const OPEN_ROUTE = ventRouteLength([], "left");

/**
 * How far the restored length may sit from the open one, in tiles.
 *
 * The figure is a sum of `1`s and `sqrt(2)`s (specs/mazing.md), so a conforming
 * build differs only in the last bits of a double. The bound is set by what has
 * to stay separated: a footprint left blocked behind a removed tower costs the
 * route at least `0.8284` tiles, so a fortieth of that gap tells a reopened floor
 * from one that only pretended to reopen.
 */
const TOLERANCE = 0.01;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns paths.left.length to its open value when the wall is removed", async () => {
  startRun(h);
  const before = h.snapshot().paths.left.length;

  const wall = poseIdleTower(h, WALL_TYPE, WALL_COL, WALL_ROW);
  h.debug.removeTower(wall);
  await h.advance(1);
  captureStill(h, "shorter");
  const after = h.snapshot().paths.left.length;

  assertLessThanOrEqual(
    Math.abs(after - before),
    TOLERANCE,
    `removing the ${WALL_TYPE} returns the left route to the ${before} it ` +
      `held before it landed; the length reported afterward was ` +
      `${after.toFixed(4)}, off by`,
  );
  assertLessThanOrEqual(
    Math.abs(after - OPEN_ROUTE),
    TOLERANCE,
    `an unblocked left corridor is ${OPEN_ROUTE} tiles across ` +
      `(specs/floor.md, specs/mazing.md); the build reported ` +
      `${after.toFixed(4)}, off by`,
  );
});
