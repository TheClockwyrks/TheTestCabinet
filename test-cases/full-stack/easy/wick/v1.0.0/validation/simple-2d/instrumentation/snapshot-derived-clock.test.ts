// instrumentation/snapshot-derived-clock — with the tick posed to 4500 and a
// moth, two gnats, and a mothwing alive, the snapshot reads time 75,
// spawnWindow 2, and aliveCommons 1.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, the "Derived from"
// table: `time` is "`tick / TICK_HZ`" (4500 / 60 = 75); `spawnWindow` is
// "`min(19, floor(time / SPAWN_WINDOW))`, with `SPAWN_WINDOW` (`30`)"
// (floor(75 / 30) = 2); `aliveCommons` is "how many of `enemies` have `rank`
// `common` in `ENEMIES` and are not `gnat`". specs/enemies.md gives the moth
// rank common, the gnat rank common, and the mothwing rank elite, so of the
// four alive exactly the moth counts.
//
// THE POSE. An isolated run with the clock through `setTick` and the four
// enemies through `spawnEnemy`, every switch off so none moves, hits, or
// despawns, and the reading taken with no tick between. The three figures are
// derivations of stored fields, so nothing has to run for them to be right.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { spawnWindowAt, TICK_HZ } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  spawnEnemyAt,
  type Harness,
} from "../harness";

const TICK = 4500;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("derives time, spawnWindow, and aliveCommons from the posed run", async () => {
  isolate(h);
  h.debug.setTick(TICK);
  spawnEnemyAt(h, "moth", 300, 0);
  spawnEnemyAt(h, "gnat", -300, 0);
  spawnEnemyAt(h, "gnat", 0, 300);
  spawnEnemyAt(h, "mothwing", 0, -300);
  const { run } = h.snapshot();
  await h.tick(1);
  captureStill(h, "clock");

  assertEqual(run.tick, TICK, "the posed tick");
  assertEqual(run.time, TICK / TICK_HZ, "time = tick / TICK_HZ");
  assertEqual(run.spawnWindow, spawnWindowAt(TICK / TICK_HZ), "spawnWindow");
  assertEqual(run.enemies.length, 4, "the enemies alive");
  assertEqual(run.aliveCommons, 1, "aliveCommons: the moth alone");
});
