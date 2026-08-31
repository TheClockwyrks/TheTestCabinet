// surge/enters-on-an-open-opening-tile — a unit appears on an OPEN opening tile of
// its vent, never on one a tower's footprint has covered.
//
// THE RULE. specs/surge.md, Entering the floor: "Its centre appears on the centre
// of an open opening tile of that vent ... A unit never appears on an opening tile
// a tower's footprint has covered." specs/mazing.md says what covered means: "A
// tower blocks every tile of its footprint from the frame it lands until the frame
// it leaves", and specs/floor.md that "An opening's tiles are ordinary floor. A
// surge unit walks onto them and a tower footprint may cover them".
//
// THE SCENARIO LEAVES EXACTLY ONE TILE OPEN, WHICH IS WHAT MAKES THE READING
// UNAMBIGUOUS. specs/floor.md puts the left vent on tiles `(0, 16)` through
// `(0, 19)`. Two 2x2 walls, anchored one row above the opening and one row inside
// it, cover the first three of those four and nothing else of the vent, so the
// specification leaves the build exactly one legal answer and every unit that comes
// through the left vent must be standing on it. A scenario that left two open would
// be satisfied by a build that ignored the covering entirely half the time.
//
// WHY THAT IS NOT A SEALED FLOOR. specs/mazing.md refuses a placement that would
// leave a vent with no route to its exhaust, and this one does not: the fourth
// opening tile stays open and the row it sits on runs clear across an otherwise
// empty floor to the right exhaust, which is the opening a left-vent unit is
// assigned (specs/floor.md). specs/mazing.md names this very arrangement as
// allowed: "A footprint covering three of the left vent's four opening tiles is
// allowed, because the route through the fourth remains."
//
// THE WALLS ARE FORGES, WHICH NEVER FIRE (specs/towers.md), so nothing on the floor
// can damage a unit and the reading is about arrival alone. They are posed with
// `addTower`, the atom that "costs nothing, spends nothing, and runs no placement
// check" (specs/instrumentation.md), so the scenario is not limited by the money a
// run opens with and this point does not depend on the placement rules the
// `building` group decides.
//
// THE UNITS COME FROM THE RUN'S OWN RELEASE, with the world gate on and the wave
// begun by the send key (surge/release.ts), because "every unit that vent releases"
// is what the requirement is about. Two waves are driven rather than one, so the
// number of units drawn to the left vent — half of them, by the seeded draw
// specs/waves.md fixes — is a comfortable sample rather than whatever one wave
// happened to give.
//
// THE READING IS TAKEN TWICE, FROM TWO PLACES IN THE SNAPSHOT. `col` and `row` are
// what the build says the unit stands on; `x` and `y` are where the build put it.
// A build that reports the open tile but placed the unit inside the wall, and one
// that placed it correctly and reports the wrong tile, are different defects and
// both are this point's. The tile behind `x` and `y` is read through this suite's
// own `tileAt`, which is specs/floor.md's inverse map computed beside the build
// rather than asked of it.
//
// WHAT EVERY WRONG MODEL READS. A build that always enters on the first tile of the
// opening reads `(0, 16)`, which is inside a wall; one that picks a tile at random
// from the opening without asking whether it is open reads a walled row most of the
// time; one that entered units on the vent's tile whatever covered it reads the
// walled rows exactly as often as it did with no wall there at all.

import { afterEach, beforeEach, it } from "vitest";
import { LEFT_VENT_ROWS } from "../../src/constants";
import { assertEqual, assertGreaterThanOrEqual, assertLength } from "../assert";
import { footprintTiles, tileAt, tileKey } from "../geometry";
import {
  captureStill,
  createHarness,
  poseTower,
  type Harness,
} from "../harness";
import {
  poseWaveReady,
  sizeOfWave,
  watchRelease,
  watchSecondsFor,
  wavesIn,
  type Release,
} from "./release";

/** The tower the walls are made of: 2x2, and it never fires (specs/towers.md). */
const WALL = "forge";

/**
 * Where the two walls are anchored.
 *
 * The first straddles the casing side of the opening, covering the row above it and
 * the opening's first row; the second covers the opening's second and third rows.
 * Between them they cover three of the left vent's four tiles and leave the last.
 */
const WALLS = [
  { col: 0, row: LEFT_VENT_ROWS[0] - 1 },
  { col: 0, row: LEFT_VENT_ROWS[1] },
] as const;

/** The waves driven, so the seeded draw sends a comfortable sample left. */
const WAVES = [1, 2] as const;

/** The fewest left-vent arrivals the reading is taken across. */
const MIN_ARRIVALS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("enters every left-vent unit on the one opening tile no wall covers", async () => {
  const waves = wavesIn();

  // Which of the vent's tiles the scenario leaves open, computed from the
  // footprints this check poses rather than read back from the build.
  const covered = new Set(
    WALLS.flatMap((wall) =>
      footprintTiles(WALL, wall.col, wall.row).map(tileKey),
    ),
  );
  const open = LEFT_VENT_ROWS.filter(
    (row) => !covered.has(tileKey({ col: 0, row })),
  );

  const arrivals: Release[] = [];
  for (const wave of WAVES) {
    poseWaveReady(h, wave);
    for (const wall of WALLS) poseTower(h, WALL, wall.col, wall.row);
    const released = await watchRelease(h, {
      seconds: watchSecondsFor(sizeOfWave(wave, waves)),
    });
    arrivals.push(...released.filter((unit) => unit.vent === "left"));
  }

  captureStill(h, "entry");

  assertLength(
    open,
    1,
    "precondition: the left vent's opening tiles the two walls left open",
  );
  assertGreaterThanOrEqual(
    arrivals.length,
    MIN_ARRIVALS,
    "precondition: the units the seeded draw sent through the left vent",
  );

  const openRow = open[0];
  for (const [index, unit] of arrivals.entries()) {
    const at = `left arrival ${index + 1}`;
    // What the build says the unit stands on.
    assertEqual(unit.col, 0, `${at}: the column of the tile it entered on`);
    assertEqual(
      unit.row,
      openRow,
      `${at}: the row of the tile it entered on, the one opening tile no ` +
        `footprint covers`,
    );
    // And where the build actually put it.
    const fell = tileAt(unit.x, unit.y);
    assertEqual(
      fell.col,
      0,
      `${at}: the column its centre x=${unit.x} falls in`,
    );
    assertEqual(
      fell.row,
      openRow,
      `${at}: the row its centre y=${unit.y} falls in`,
    );
  }
});
