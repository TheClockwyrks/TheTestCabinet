// Meltdown — towers/mover-stats: the Forge and the Sink carry their row.
//
// THE ROW. specs/towers.md, The Forge and the Sink: "Both are 2x2, cost `20`,
// never fire, carry no heat, and have no radiator faces at any rotation. They do
// not rotate." And the table beneath it gives each one's level-I output — the
// Forge's setpoint `72` against the Sink's per-shared-edge cooling `16`.
//
// WHAT IS DECIDED HERE AND WHAT IS NOT. This item is the movers' entry in the
// ROSTER: the cost, the footprint, the empty face list, and the output figure the
// snapshot reports. What each output DOES to a neighbouring emitter — the Forge's
// thermostat flow toward its setpoint and the Sink's drain proportional to heat —
// is `movers/`'s business, and neither is driven here. Nothing else stands on the
// floor while this reads, so no flow runs at all.
//
// THE EMPTY FACE LIST IS READ AT ALL FOUR ROTATIONS, and that is the whole point
// of the reading. "No radiator faces at any rotation" is a claim about four
// values, not one: a build that gives a mover the roster's default `N, S` and
// turns them correctly reports `["S","W"]` at rotation 1 and `["N","S"]` at
// rotation 0, so a reading taken at rotation 0 alone would name the first and miss
// nothing — but a build that empties the list only at rotation 0 would pass it.
// Four poses, one per rotation, and the failure names the rotation it came from.
//
// THE TWO OUTPUTS ARE READ AGAINST EACH OTHER, because that is where the two rows
// are actually distinguishable: both movers cost the same, occupy the same
// footprint and carry the same empty face list, so `output` is the ONLY field the
// snapshot separates them by. A build that gave both the same number, or that
// swapped them, reads `72` where `16` is due.
//
// THE OUTPUT IS READ AT LEVEL I ALONE. `movers/forge-setpoint-scales` and
// `movers/sink-output-scales` are the items about the per-level table; a tower
// posed by `addTower` opens at level `1` (specs/instrumentation.md), so what is
// read here is the first column of it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseTower,
  startRun,
  towerOf,
  type Harness,
} from "../harness";
import { costOf, freeSite, moverOutputOf, sortedFaces } from "./roster";

/** The two movers specs/towers.md tabulates together. */
const MOVERS = ["forge", "sink"] as const;

/** Both figures the two share, off the case's own seeded table. */
const COST = costOf("forge"); // 20, and the Sink's is the same
const SIZE = 2;

/** The four placement rotations, each of which must leave the face list empty. */
const ROTATIONS = [0, 1, 2, 3];

/** The level a posed tower opens at (specs/instrumentation.md). */
const LEVEL = 1;

/** The level-I outputs specs/towers.md separates the two rows by: 72 and 16. */
const OUTPUTS = {
  forge: moverOutputOf("forge", LEVEL),
  sink: moverOutputOf("sink", LEVEL),
} as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("The Forge and the Sink carry their stats", async () => {
  startRun(h);

  // Both movers, side by side on quiet anchors far enough apart that neither
  // touches the other: nothing on this floor drives a flow into anything.
  const posed = MOVERS.map((type, index) => {
    const at = freeSite(index);
    return { type, id: poseTower(h, type, at.col, at.row) };
  });
  h.debug.setSelected(posed[0].id);
  await h.advance(1);
  captureStill(h, "movers");

  const snapshot = h.snapshot();
  for (const { type, id } of posed) {
    const tower = towerOf(snapshot, id);
    assertEqual(tower.size, SIZE, `the ${type}'s footprint side, in tiles`);
    assertEqual(
      tower.spent,
      COST,
      `the ${type}'s build cost, as the spent a fresh tower opens with`,
    );
    assertEqual(
      tower.output,
      OUTPUTS[type],
      `the ${type}'s level-${LEVEL} output: the Forge's setpoint is ` +
        `${OUTPUTS.forge} and the Sink's per-shared-edge cooling is ` +
        `${OUTPUTS.sink} (specs/towers.md)`,
    );
  }

  // ---- No radiator faces at ANY rotation ----------------------------------
  for (const rotation of ROTATIONS) {
    startRun(h);
    const turned = MOVERS.map((type, index) => {
      const at = freeSite(index);
      return { type, id: poseTower(h, type, at.col, at.row, rotation) };
    });
    const read = h.snapshot();
    for (const { type, id } of turned) {
      assertDeepEqual(
        sortedFaces(towerOf(read, id).radiatorFaces),
        [],
        `the world radiator faces of a ${type} at rotation ${rotation}, which ` +
          `specs/towers.md leaves empty at every rotation`,
      );
    }
  }
});
