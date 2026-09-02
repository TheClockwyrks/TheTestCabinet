// mazing/towers-block-tiles — a tower blocks its whole footprint, at every size.
//
// specs/mazing.md: "A tower blocks every tile of its footprint from the frame it
// lands until the frame it leaves, whatever its size and whatever kind of tower
// it is. ... A blocked tile is not open floor: no surge route passes through
// one." specs/towers.md gives the three footprint sizes: 2 (Arc), 3 (Bloom),
// 4 (Lance).
//
// WHAT IS READ, AND WHY IT IS THE WHOLE FOOTPRINT THAT IS BEING DECIDED. A
// route's tile sequence is not observable — and must not be asserted, because
// specs/mazing.md fixes no tie-break among equal-cost routes. What IS observable
// is the route's LENGTH, which the snapshot reports as a unit's `remaining` in
// the metric the specification states. So one tower is posed across the left
// corridor and a unit stands three tiles west of it, and the reading is the route
// length from that tile, computed HERE over the blocked set the tower's own SIZE
// makes.
//
// EVERY WRONG MODEL READS AS A DIFFERENT NUMBER, which is the point of measuring
// it at each size from the same tile. From tile (21, 17) with the footprint
// anchored at (24, 16):
//
//   | what the build blocked | the route it reports |
//   | ---------------------- | -------------------- |
//   | nothing at all         | 28.0000              |
//   | a 2x2 footprint        | 28.4142              |
//   | a 3x3 footprint        | 28.8284              |
//   | a 4x4 footprint        | 29.2426              |
//
// so a build that walks over towers, one that always blocks 2x2 whatever the
// type, and one that blocks the anchor tile alone are each named by the figure
// they produced rather than merely failed. The three legs share one anchor for
// exactly that reason: the correct answer for one size is the wrong answer for
// the other two.
//
// THE POSE. Guns off on the tower, because walling is the only faculty this
// requirement exercises, and motion off on the unit, because a route length read
// while the unit walks out of the tile it was read from measures the reading's
// own latency. specs/instrumentation.md states that a unit with its motion off
// still has its route computed from the tile it stands on, so `remaining` follows
// the floor exactly as it does for a walker.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { LEFT_VENT_ROWS } from "../constants";
import { sizeOf } from "../geometry";
import {
  captureStill,
  createHarness,
  poseIdleTower,
  poseTarget,
  startRun,
  unitOf,
  type Harness,
  type TowerType,
} from "../harness";
import { remainingFromTile } from "./geometry";

/**
 * Where the footprint is anchored: on the left corridor's first row, well clear
 * of both openings, so a route from the west has to go around it.
 */
const WALL_COL = 24;
const WALL_ROW = LEFT_VENT_ROWS[0];

/** Where the unit stands: three tiles west of the footprint, on the corridor. */
const PROBE_COL = 21;
const PROBE_ROW = LEFT_VENT_ROWS[1];

/** One tower of each size specs/towers.md gives, in ascending size. */
const AT_EVERY_SIZE: readonly TowerType[] = ["arc", "bloom", "lance"];

/**
 * How far the reported route may sit from the computed one, in tiles.
 *
 * The metric is a sum of `1`s and `sqrt(2)`s (specs/mazing.md), so a build
 * summing it in a different order differs in the last bits of a double and
 * nothing more. The bound is set instead by what has to stay separated: the four
 * models above are `0.4142` tiles apart, so anything under a tenth of that keeps
 * them apart, and this is a fortieth.
 */
const TOLERANCE = 0.01;

/** The route from the probe tile with nothing blocked at all: 28 tiles. */
const OPEN_FLOOR_ROUTE = remainingFromTile([], "right", PROBE_COL, PROBE_ROW);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("routes the surge around every tile of a footprint, at all three sizes", async () => {
  for (const type of AT_EVERY_SIZE) {
    const size = sizeOf(type);
    const where = `a ${size}x${size} ${type} footprint at (${WALL_COL}, ${WALL_ROW})`;

    // A floor holding nothing but this one tower and one unit, so the route read
    // is the route this footprint alone makes.
    startRun(h);
    poseIdleTower(h, type, WALL_COL, WALL_ROW);
    const unit = poseTarget(h, "mote", PROBE_COL, PROBE_ROW);
    await h.advance(1);
    // The picture is kept from the largest footprint, which is the one whose
    // whole extent a reviewer can see the surge routed around.
    if (type === AT_EVERY_SIZE[AT_EVERY_SIZE.length - 1]) {
      captureStill(h, "blocked");
    }

    const measured = unitOf(h.snapshot(), unit).remaining;
    const expected = remainingFromTile(
      [{ type, col: WALL_COL, row: WALL_ROW }],
      "right",
      PROBE_COL,
      PROBE_ROW,
    );

    assertLessThanOrEqual(
      Math.abs(measured - expected),
      TOLERANCE,
      `the route from (${PROBE_COL}, ${PROBE_ROW}) around ${where} is ` +
        `${expected.toFixed(4)} tiles; the build reported ` +
        `${measured.toFixed(4)}, off by`,
    );
    assertGreaterThan(
      measured,
      OPEN_FLOOR_ROUTE + TOLERANCE,
      `${where} lengthens the route past the ${OPEN_FLOOR_ROUTE} tiles an ` +
        `unblocked floor gives; the route reported was`,
    );
  }
});
