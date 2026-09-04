// mazing/never-takes-the-nearer-exhaust — a unit two tiles from the wrong exhaust
// still walks to its own.
//
// specs/floor.md: a unit that enters at a vent is assigned that vent's opposite
// exhaust for its whole life and never the nearer one, so each stream crosses the
// whole floor. And specs/mazing.md measures a route "from the tile its centre
// occupies to any open opening tile of its assigned exhaust" — the other exhaust
// is not a goal, however close it is.
//
// THE DISTINGUISHING VALUE. A left-vent unit is put down on tile (25, 33): two
// rows above the bottom exhaust and inside its run of columns, and twenty-nine
// tiles from the right exhaust it was actually assigned. The two models are
// nowhere near each other:
//
//   | the exhaust the build routed to | the route it reports |
//   | ------------------------------ | -------------------- |
//   | the right exhaust (assigned)   | 29.7990              |
//   | the bottom exhaust (nearer)    | 2                    |
//
// so a build that routes to the nearest exhaust is named by the figure it
// produced. Both are computed here from the specification's own metric.
//
// AND THEN IT IS LET GO. The reading above is a route length; whether the unit
// LEAVES through the nearer exhaust is a second thing, so its motion is left on
// and two seconds of game time are run. A Mote covers `120` logical units in that
// time at its own `60` units per second (specs/surge.md), and the bottom exhaust
// is `38` units away — six-tenths of a second — so a build heading for it is gone
// from the roster well inside the window. A build that honours the assignment is
// still on the floor and its remaining has fallen.
//
// THE POSE. Nothing on the floor but the unit, so no wall decides which way it
// goes; specs/instrumentation.md's `setUnitPosition` places the unit's centre and
// recomputes its route from that tile, and leaves its vent and exhaust alone,
// which is exactly the scenario this point is about.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan, assertLessThanOrEqual } from "../assert";
import { SURGE_DEFS, TILE, tileCX, tileCY } from "../constants";
import {
  captureStill,
  createHarness,
  poseWalker,
  startRun,
  ticksFor,
  type Harness,
} from "../harness";
import { remainingFromTile } from "./routes";
import { unitOf } from "./scenario";

/**
 * Where the unit is put down: two rows above the bottom exhaust, inside the run
 * of columns it opens onto (specs/floor.md gives it columns 22..29 on row 35).
 */
const START_COL = 25;
const START_ROW = 33;

/** The route to the exhaust the unit was assigned: 29.7990 tiles. */
const TO_ASSIGNED = remainingFromTile([], "right", START_COL, START_ROW);

/** What a build that routed to the nearer exhaust would report: 2 tiles. */
const TO_NEARER = remainingFromTile([], "bottom", START_COL, START_ROW);

/**
 * How far the reported route may sit from the computed one, in tiles.
 *
 * The metric is a sum of `1`s and `sqrt(2)`s (specs/mazing.md), so a conforming
 * build differs only in the last bits of a double. The bound is set by what has
 * to stay separated: the two models above are `27.8` tiles apart.
 */
const TOLERANCE = 0.01;

/**
 * How long the unit is then let walk, in seconds of game time.
 *
 * Three times what the `38` logical units to the nearer exhaust cost a Mote at
 * its own `60` units per second (specs/surge.md), so a build heading there has
 * left the floor well inside the window.
 */
const WALK_SECONDS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("routes a left-vent unit to the right exhaust from beside the bottom one", async () => {
  startRun(h);
  const walker = poseWalker(h, "mote", "left");
  h.debug.setUnitPosition(walker, tileCX(START_COL), tileCY(START_ROW));
  await h.advance(1);
  captureStill(h, "route");

  const posed = unitOf(h.snapshot(), walker);

  assertEqual(
    posed.exhaust,
    "right",
    "the exhaust a left-vent unit keeps for its whole life (specs/floor.md)",
  );
  assertLessThanOrEqual(
    Math.abs(posed.remaining - TO_ASSIGNED),
    TOLERANCE,
    `the route from (${START_COL}, ${START_ROW}) to the assigned right ` +
      `exhaust is ${TO_ASSIGNED.toFixed(4)} tiles; the nearer bottom exhaust ` +
      `would read ${TO_NEARER}. The build reported ` +
      `${posed.remaining.toFixed(4)}, off the assigned route by`,
  );

  await h.advance(ticksFor(WALK_SECONDS));
  // A build routing to the nearer exhaust would have leaked this unit after
  // (TO_NEARER * TILE) / speed seconds, so `unitOf` failing here is the verdict.
  const walked = unitOf(h.snapshot(), walker);
  assertLessThan(
    walked.remaining,
    posed.remaining,
    `the unit closes on the exhaust it was assigned rather than the one two ` +
      `tiles away, which a build heading there would have reached in ` +
      `${((TO_NEARER * TILE) / SURGE_DEFS.mote.speed).toFixed(2)} s; its ` +
      `remaining after ${WALK_SECONDS} s was`,
  );
});
