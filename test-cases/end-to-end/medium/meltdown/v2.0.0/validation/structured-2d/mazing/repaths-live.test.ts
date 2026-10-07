// mazing/repaths-live — a wall landing across a walker's way re-paths it at once,
// from the tile it is standing on.
//
// specs/mazing.md: "Every route is recomputed on the frame the set of blocked
// tiles changes: a tower placed, a tower sold, or a tower otherwise added to or
// removed from the floor. Each unit's route is recomputed from the tile its
// centre occupies at that moment". specs/instrumentation.md reports the result as
// the unit's `remaining`, "route length still to travel, in tiles".
//
// WHAT IS READ. The unit is walking under its own power from the left vent. A 4x4
// Lance then lands across the whole four-row corridor ahead of it and ONE frame
// is run — the frame the wall lands on — and the reading is the unit's
// `remaining` on that frame, held to the route length the metric gives for the
// tile the build itself says the unit is standing on. Taking the tile from the
// reported centre is deliberate: the requirement is that the route is recomputed
// FROM THE TILE IT STANDS ON, so the check demands the route for wherever the
// frame's own movement left it, and the tile arithmetic is specs/floor.md's
// rather than the `col`/`row` the build reports.
//
// THE FIGURES. The unit is walked for `1.9` seconds first, which at a Mote's own
// `60` units per second (specs/surge.md) carries it `114` units from the centre
// of a vent opening tile to the exact centre of tile column `6` — the furthest
// point from a tile boundary anywhere, so the one frame the wall lands on cannot
// also carry it into the next tile and confuse a route that is measured per tile.
// From column `6` the open corridor is `43` tiles and the walled one is `43.8284`
// on the corridor's outer rows and `44.2426` on its inner two, so the rise is
// unmistakable and a build reporting the stale figure is named by it.
//
// WHY THE WALL'S GUNS ARE OFF. A Lance dropped a few tiles from a Mote would
// shoot it, and a route reading taken off a unit that is being killed measures
// the wrong thing. specs/instrumentation.md's firing gate holds targeting and the
// shot and nothing else, so the wall walls exactly as specs/mazing.md says a
// tower of any kind does.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { LEFT_VENT_ROWS } from "../constants";
import {
  captureReplay,
  createHarness,
  poseIdleTower,
  poseWalker,
  startRun,
  ticksFor,
  tileAtPoint,
  type Harness,
  type TowerType,
  type UnitSnapshot,
} from "../harness";
import { remainingFromTile } from "./routes";
import { unitOf } from "./scenario";

/** The type whose 4x4 footprint spans the corridor's whole four-row run. */
const WALL_TYPE: TowerType = "lance";

/** Where the wall lands: twenty tiles in, anchored on the corridor's first row. */
const WALL_COL = 20;
const WALL_ROW = LEFT_VENT_ROWS[0];

/**
 * How long the unit walks before the wall lands, in seconds of game time.
 *
 * A Mote covers `60` units a second (specs/surge.md) and enters on the centre of
 * a vent opening tile, so `1.9` s is `114` units, which is exactly six tiles: the
 * unit is at a tile centre, half a tile from either boundary, and the single
 * frame the wall lands on moves it half a unit.
 */
const APPROACH_SECONDS = 1.9;

/** A short tail, so the replay shows the unit walking the route it was given. */
const TAIL_SECONDS = 1.0;

/**
 * How far the reported route may sit from the computed one, in tiles.
 *
 * The metric is a sum of `1`s and `sqrt(2)`s (specs/mazing.md), so a conforming
 * build differs only in the last bits of a double. The bound is set by what has
 * to stay separated: the wall raises the route by at least `0.8284` tiles, so a
 * fortieth of that gap tells a live re-path from a stale one.
 */
const TOLERANCE = 0.01;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("recomputes a walker's remaining on the frame a wall lands across its way", async () => {
  startRun(h);
  const walker = poseWalker(h, "mote", "left");

  const legs = await captureReplay(
    h,
    "repath",
    async (): Promise<{ before: UnitSnapshot; after: UnitSnapshot }> => {
      await h.advance(ticksFor(APPROACH_SECONDS));
      const before = unitOf(h.snapshot(), walker);

      poseIdleTower(h, WALL_TYPE, WALL_COL, WALL_ROW);
      await h.advance(1);
      const after = unitOf(h.snapshot(), walker);

      await h.advance(ticksFor(TAIL_SECONDS));
      return { before, after };
    },
  );

  const standing = tileAtPoint(legs.after.x, legs.after.y);
  const expected = remainingFromTile(
    [{ type: WALL_TYPE, col: WALL_COL, row: WALL_ROW }],
    "right",
    standing.col,
    standing.row,
  );

  assertLessThanOrEqual(
    Math.abs(legs.after.remaining - expected),
    TOLERANCE,
    `the route to the right exhaust from tile (${standing.col}, ` +
      `${standing.row}) with the wall up is ${expected.toFixed(4)} tiles; the ` +
      `build reported ${legs.after.remaining.toFixed(4)}, off by`,
  );
  assertGreaterThan(
    legs.after.remaining,
    legs.before.remaining + TOLERANCE,
    `a ${WALL_TYPE} spanning the corridor ahead lengthens the unit's ` +
      `remaining past the ${legs.before.remaining.toFixed(4)} tiles it read ` +
      `on the open floor; the figure reported on the frame the wall landed was`,
  );
});
