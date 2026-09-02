// Meltdown — surge/enters-on-an-open-opening-tile: nobody arrives inside a wall.
//
// THE RULE. `specs/surge.md`, Entering the floor: "Its centre appears on the centre
// of an OPEN opening tile of that vent... A unit never appears on an opening tile a
// tower's footprint has covered." `specs/mazing.md` is what makes such a tile
// possible: "An opening's tiles are ordinary floor, so a footprint may cover part
// of an opening. A footprint covering three of the left vent's four opening tiles
// is allowed, because the route through the fourth remains."
//
// THE ARRANGEMENT, AND WHY IT LEAVES EXACTLY ONE ANSWER. `specs/floor.md` opens the
// left vent on tiles `(0, 16)` through `(0, 19)`. Two 2x2 footprints anchored at
// `(0, 15)` and `(0, 17)` cover columns 0 and 1 over rows 15 to 18, so three of the
// four opening tiles — 16, 17 and 18 — are blocked and `(0, 19)` is the only one
// left open. The specification therefore fixes the arrival tile exactly, and the
// reading is an equality rather than a membership: every unit the left vent
// releases must stand on `(0, 19)`. That is what the item means by posing the
// distinguishing value — a build that ignores the blocked set and takes the first
// tile of the run reads `(0, 16)`, a build that takes the middle reads `(0, 17)` or
// `(0, 18)`, and each is a different wrong answer.
//
// WHY THE FLOOR IS STILL LEGAL. The route through `(0, 19)` remains, so the vent is
// not sealed (`specs/mazing.md`) and the run this point poses is one the game would
// allow a player to build. The towers are posed with their guns held off — a wall
// is a wall, "whatever kind of tower it is", and a check about arriving has no
// business also running a firing line at what it posed
// (`specs/instrumentation.md`, the firing gate).
//
// WHY THE UNITS ARE RELEASED RATHER THAN ADDED. The item is about what the vent
// RELEASES, so the world gate goes back on and the run's own spawner does the
// entering. Its vent is drawn from the seeded generator (`specs/waves.md`), so
// roughly half the wave arrives at the top vent instead; those are not this point's
// and are passed over, and the precondition below states how many left-vent
// arrivals the reading was actually taken on.
//
// WHY EACH ARRIVAL IS HELD WHERE IT ARRIVED. The requirement is about the moment of
// entry, so every unit is stopped on the frame it is first seen
// (`setUnitMotion(id, false)`, `specs/instrumentation.md`) and the tile read is the
// tile it appeared on rather than one a frame of walking carried it to. It also
// keeps the release running to its end: nothing leaks, so nothing takes lives.
//
// THE READING IS TAKEN TWICE, FROM TWO PLACES IN THE SNAPSHOT. `col` and `row` are
// what the build says the unit stands on; `x` and `y` are where the build put it.
// `specs/floor.md` fixes the map between them, so a build that reports the open
// tile but placed the unit inside the wall, and one that placed it correctly but
// reports the wrong tile, are different defects and both are this item's. The tile
// is recomputed from the centre through this suite's own `tileAtPoint`, which is
// `specs/floor.md`'s inverse map worked out beside the build rather than asked of
// it. And no tower may stand on the tile either way, which is the item's own words.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertUndefined,
} from "../assert";
import { LEFT_VENT_ROWS } from "../constants";
import {
  captureStill,
  createHarness,
  poseIdleTower,
  ticksFor,
  tileAtPoint,
  towerOn,
  type Harness,
} from "../harness";
import { poseWavePhase, watchReleases } from "./scenario";

/** The one opening tile of the left vent left open: its last row. */
const OPEN_TILE = { col: 0, row: LEFT_VENT_ROWS[3] } as const;

/**
 * The two 2x2 footprints that wall the other three.
 *
 * Anchored at `(0, 15)` and `(0, 17)`, they cover columns 0 and 1 over rows 15 to
 * 18, which is opening rows 16, 17 and 18 and nothing of row 19. The Arc is the
 * 2x2 the roster's cheapest emitter uses (`specs/towers.md`); which type it is does
 * not matter, because every tower blocks its whole footprint.
 */
const WALLS = [
  { col: 0, row: 15 },
  { col: 0, row: 17 },
] as const;

/** The wave the units are released for; its type is nothing to do with this point. */
const WAVE = 1;

/** Units the spawner is handed, of which roughly half arrive at the left vent. */
const PENDING = 24;

/**
 * Seconds of game time the release is watched for: eighteen.
 *
 * Geometry rather than a tolerance. Twenty-four units at `specs/waves.md`'s
 * `0.6`-second cadence are all out inside fifteen seconds; eighteen leaves room for
 * a build whose release clock runs a little slow.
 */
const WATCH_TICKS = ticksFor(18);

/** Frames between two samples: a twentieth of a second, well inside one interval. */
const POLL_FRAMES = 6;

/** The fewest left-vent arrivals the reading is taken on. */
const MIN_ARRIVALS = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("enters every left-vent unit on the one opening tile left open", async () => {
  poseWavePhase(h, WAVE, PENDING, "containment", "medium");
  for (const wall of WALLS) poseIdleTower(h, "arc", wall.col, wall.row);

  const watch = await watchReleases(h, WATCH_TICKS, {
    poll: POLL_FRAMES,
    // Stopped on the frame it was first seen, so the tile read below is the tile
    // it appeared on and not one a frame of walking carried it to.
    onRelease: (release) => h.debug.setUnitMotion(release.id, false),
  });
  captureStill(h, "entry");

  const arrivals = watch.releases.filter((release) => release.vent === "left");
  assertGreaterThanOrEqual(
    arrivals.length,
    MIN_ARRIVALS,
    `precondition: the left vent released enough units for the reading ` +
      `(${watch.releases.length} units arrived in all, their vents drawn from ` +
      `the seeded generator)`,
  );

  const walled = h.snapshot();
  for (const [index, arrival] of arrivals.entries()) {
    const at = `left-vent unit ${index + 1} of ${arrivals.length}`;
    // What the build says the unit stands on.
    assertEqual(arrival.col, OPEN_TILE.col, `${at}: the column it entered on`);
    assertEqual(
      arrival.row,
      OPEN_TILE.row,
      `${at}: the row it entered on, the only opening tile of the left vent ` +
        `left open (specs/surge.md)`,
    );
    // And where the build actually put it, read through specs/floor.md's map.
    const fell = tileAtPoint(arrival.x, arrival.y);
    assertEqual(
      fell.col,
      OPEN_TILE.col,
      `${at}: the column its centre x=${arrival.x} falls in`,
    );
    assertEqual(
      fell.row,
      OPEN_TILE.row,
      `${at}: the row its centre y=${arrival.y} falls in`,
    );
    // And nothing stands on it, which is the item in its own words.
    assertUndefined(
      towerOn(walled, arrival.col, arrival.row),
      `${at}: the tower covering the tile it entered on, of which there must ` +
        `be none (specs/surge.md)`,
    );
  }
});
