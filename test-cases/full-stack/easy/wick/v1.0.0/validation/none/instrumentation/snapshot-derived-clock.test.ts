// Wick — instrumentation/snapshot-derived-clock: with the tick posed to 4500
// and a moth, two gnats, and a mothwing alive, the snapshot reads `time` 75,
// `spawnWindow` 2, and `aliveCommons` 1.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Snapshot shape",
// the derived-fields table): "`time` | `tick / TICK_HZ`"; "`spawnWindow` |
// `min(19, floor(time / SPAWN_WINDOW))`, with `SPAWN_WINDOW` (`30`)";
// "`aliveCommons` | how many of `enemies` have `rank` `common` in `ENEMIES` and
// are not `gnat`". `4500 / 60` is `75` exactly, `floor(75 / 30)` is `2`, and of
// the four alive only the moth is a common that is not a gnat.
//
// WHY THE WORLD IS POSED AS IT IS. The two gnats and the mothwing are the two
// exclusions the count names, posed beside the one enemy it counts, so a build
// counting every enemy reads 4, one counting every common reads 3, and one
// leaving out only the elite reads 3. The night is isolated and every faculty
// held so nothing else spawns or dies before the read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { spawnWindowIndex, TICK_HZ } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";

const POSED_TICK = 4500;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("derives time, spawnWindow, and aliveCommons from the clock and the enemies", async () => {
  await isolate(h);
  await h.debug.setTick(POSED_TICK);
  await placeEnemy(h, "moth", 200, 0);
  await placeEnemy(h, "gnat", -200, 0);
  await placeEnemy(h, "gnat", 0, 200);
  await placeEnemy(h, "mothwing", 0, -300);
  const s = await h.snapshot();
  await captureStill(h, "clock");

  assertEqual(s.run.tick, POSED_TICK, "the posed tick");
  assertEqual(s.run.time, POSED_TICK / TICK_HZ, "time from the tick");
  assertEqual(
    s.run.spawnWindow,
    spawnWindowIndex(POSED_TICK / TICK_HZ),
    "spawnWindow from the time",
  );
  assertEqual(s.run.enemies.length, 4, "the enemies alive");
  assertEqual(
    s.run.aliveCommons,
    1,
    "aliveCommons: the moth alone, gnats and the elite left out",
  );
});
