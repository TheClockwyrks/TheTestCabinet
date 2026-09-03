// Wick — instrumentation/snapshot-derived-clock: the snapshot derives `time`,
// `spawnWindow`, and `aliveCommons`.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, the
// derived table under "Snapshot shape":
//   `time`         = tick / TICK_HZ                         → 75 at tick 4500
//   `spawnWindow`  = min(19, floor(time / SPAWN_WINDOW (30))) → 2 at 75 s
//   `aliveCommons` = "how many of `enemies` have `rank` `common` in `ENEMIES`
//                    and are not `gnat`" → 1 for a moth beside two gnats and a
//                    mothwing (rank `elite`, specs/enemies.md).
//
// THE POSE. An isolated run, every switch off, the clock posed to 4500 and
// the four enemies placed well apart from the lamplighter and each other so
// nothing overlaps. Read before any tick: the fields derive from the state at
// the read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TICK_HZ, spawnWindowOf } from "../constants";
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

afterEach(() => {
  h.dispose();
});

it("reads time 75, spawnWindow 2, and aliveCommons 1", async () => {
  isolate(h);
  h.debug.setTick(POSED_TICK);
  placeEnemy(h, "moth", 300, 0);
  placeEnemy(h, "gnat", -300, 0);
  placeEnemy(h, "gnat", 0, 300);
  placeEnemy(h, "mothwing", 0, -300);

  const { run } = h.snapshot();
  await h.frameDraw();
  captureStill(h, "clock");

  assertEqual(run.tick, POSED_TICK, "run.tick as posed");
  assertEqual(run.time, POSED_TICK / TICK_HZ, "run.time at tick 4500");
  assertEqual(
    run.spawnWindow,
    spawnWindowOf(POSED_TICK / TICK_HZ),
    "run.spawnWindow at 75 s",
  );
  assertEqual(run.enemies.length, 4, "the enemies posed");
  assertEqual(
    run.aliveCommons,
    1,
    "run.aliveCommons with a moth, two gnats, and a mothwing",
  );
});
