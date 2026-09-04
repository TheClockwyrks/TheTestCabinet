// Meltdown — surge/enters-on-an-open-opening-tile: a unit never appears inside a
// tower.
//
// THE RULE. `specs/surge.md`, under Entering the floor: "A unit enters at one of
// the two vents. Its centre appears on the centre of an open opening tile of that
// vent ... A unit never appears on an opening tile a tower's footprint has
// covered." `specs/floor.md` puts the left vent on tiles `(0, 16)` through
// `(0, 19)` and makes an opening's tiles "ordinary floor" a footprint may cover,
// and `specs/mazing.md` allows exactly this arrangement: "A footprint covering
// three of the left vent's four opening tiles is allowed, because the route
// through the fourth remains."
//
// THE ARRANGEMENT IS THE SPECIFICATION'S OWN EXAMPLE. Two 2x2 Arcs, anchored at
// `(0, 15)` and `(0, 17)`, cover the vent's tiles `16`, `17` and `18` and leave
// `19` open. Nothing else stands on the floor. The choice of anchors is what makes
// three the number covered: a 2x2 at `(0, 15)` reaches only one opening tile,
// because row `15` is ordinary floor above the opening, and the one at `(0, 17)`
// takes the two below it. The towers are added rather than placed, because
// `addTower` "runs no placement check" (`specs/instrumentation.md`) and what is
// under test is where a unit APPEARS, not whether the footprint is legal —
// `mazing/partial-opening-allowed` decides that.
//
// WHAT THE READING SEPARATES. A build that picks a tile from the vent's run
// without asking whether it is open puts three units in four inside a tower,
// where they are unreachable, unshootable, or wedged; a build that clamps to the
// first tile of the run puts every one of them inside the Arc at `(0, 15)`; a
// build that spawns on the casing edge instead of the tile lands off the grid.
// Each of those reads a different `(col, row)` from `(0, 19)`, so the failure
// names the model.
//
// EVERY FRAME IS SAMPLED, so each unit is read at the tile it entered on rather
// than wherever it has walked to: a Mote covers a tile of floor in a third of a
// second and the interval between two samples is `1 / 120` of one.
//
// ONLY THE LEFT VENT'S UNITS ARE READ. The vent each unit draws is seeded
// (`surge/vent-drawn-from-the-seed`), so a wave puts some units through the top
// vent, whose opening is untouched here and whose entry tile this item says
// nothing about. The sweep runs until enough have come through the walled vent,
// and that count is the precondition.
//
// THE WAVE IS THE FORTY-UNIT ONE, and the reason is the seeded draw rather than
// anything about the wave. The three left-vent entries this item reads have to
// ARRIVE, and how many of a wave go left is the generator's business, not a rule
// any build can be held to: over twelve draws a conformant build with a different
// generator would fall short of three about one run in fifty, which would be a
// check that failed a correct build. Over forty it is one run in a thousand
// million. The sweep stops the moment the third arrives, so the long wave costs
// nothing in the ordinary case.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertGreaterThanOrEqual } from "../assert";
import {
  LEFT_VENT_ROWS,
  WAVE_SPAWN_INTERVAL,
  colAt,
  rowAt,
  waveSize,
} from "../constants";
import {
  captureStill,
  createDriveHarness,
  driveFrames,
  poseTower,
  type Harness,
  type MeltdownSnapshot,
} from "../harness";
import { openWave } from "./roster";

/** The run and the wave read: wave 4 of a twenty-wave run, forty Swarms. */
const WAVE_COUNT = 20;
const WAVE = 4;

/**
 * The two 2x2 footprints that wall three of the left vent's four opening tiles.
 *
 * `(0, 15)` covers rows `15..16`, of which only `16` is an opening tile; `(0, 17)`
 * covers rows `17..18`. Between them the vent's `16`, `17` and `18` are blocked
 * and `19` is not.
 */
const WALLS: readonly { col: number; row: number }[] = [
  { col: 0, row: 15 },
  { col: 0, row: 17 },
];

/** The one opening tile of the left vent left open: `(0, 19)`. */
const OPEN_TILE = { col: 0, row: LEFT_VENT_ROWS[3] } as const;

/**
 * How many units must come through the walled vent before the reading is taken.
 *
 * The vent is drawn from the seeded generator, so how many of the wave's forty
 * arrive at the left one is not fixed by any rule this item is about. Three is
 * enough that a build choosing a tile at random from the vent's run passes only
 * one time in sixty-four, and it is a fifteenth of what an equal draw sends left,
 * so no conformant generator falls short of it. It is a precondition on the
 * scenario, not a threshold on the build.
 */
const LEFT_UNITS_READ = 3;

/** How long the sweep may run: the whole of the wave's release, with a second over. */
const SWEEP_FRAMES = driveFrames(
  WAVE_SPAWN_INTERVAL * waveSize(WAVE, WAVE_COUNT) + 1,
);

let h: Harness;

beforeEach(async () => {
  h = await createDriveHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("enters every left-vent unit on the one opening tile no footprint covers", async () => {
  await openWave(h, WAVE, "medium", async () => {
    for (const wall of WALLS) await poseTower(h, "arc", wall.col, wall.row);
  });

  // Each unit at the tile it was first seen on, sampled every frame of the
  // long-drive clock (`harness.ts`, The long-drive clock) so that is the tile it
  // entered on: one of its frames is a thirtieth of a second, in which the fastest
  // unit in the game covers four of the nineteen logical units a tile is wide, so
  // a unit is still on its entry tile when it is read. Only the left vent's are
  // kept: the top vent's opening is untouched and says nothing about this rule.
  const seen = new Set<number>();
  const entries: {
    id: number;
    col: number;
    row: number;
    x: number;
    y: number;
  }[] = [];
  const record = (snapshot: MeltdownSnapshot): void => {
    for (const unit of snapshot.surge) {
      if (seen.has(unit.id)) continue;
      seen.add(unit.id);
      if (unit.vent === "left") {
        entries.push({
          id: unit.id,
          col: unit.col,
          row: unit.row,
          x: unit.x,
          y: unit.y,
        });
      }
    }
  };
  record(await h.snapshot());
  await h.until(
    (snapshot) => {
      record(snapshot);
      return entries.length >= LEFT_UNITS_READ;
    },
    { maxFrames: SWEEP_FRAMES, poll: 1 },
  );

  await captureStill(h, "entry");

  assertGreaterThanOrEqual(
    entries.length,
    LEFT_UNITS_READ,
    "precondition: units the seeded draw sent through the walled left vent " +
      `inside wave ${WAVE}'s release`,
  );
  for (const entry of entries) {
    assertDeepEqual(
      { col: entry.col, row: entry.row },
      { col: OPEN_TILE.col, row: OPEN_TILE.row },
      `the tile unit ${entry.id} appeared on: three of the left vent's four ` +
        `opening tiles are covered by a footprint, so every unit that vent ` +
        `releases appears on the fourth (specs/surge.md)`,
    );
    // And where the build actually PUT it, read back through specs/floor.md's
    // own map from a stage position to a tile. The pair matters because the two
    // readings can disagree: a build reporting the tile it meant while standing
    // the unit somewhere else has not entered it on the open tile, and the
    // reported col and row alone would never say so.
    assertDeepEqual(
      { col: colAt(entry.x), row: rowAt(entry.y) },
      { col: OPEN_TILE.col, row: OPEN_TILE.row },
      `the tile unit ${entry.id}'s own position (${entry.x.toFixed(2)}, ` +
        `${entry.y.toFixed(2)}) falls in, under the tile map specs/floor.md ` +
        `fixes`,
    );
  }
});
