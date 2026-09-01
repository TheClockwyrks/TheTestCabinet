// director/cap-holds-timer — a full cap holds the timer's spawns, and the timer
// rests at `0`.
//
// WHERE THE THRESHOLD COMES FROM. specs/enemies.md ("The spawn timer"): "if
// spawnTimer is due and aliveCommons < cap: spawn one enemy ... spawnTimer =
// interval", so a due timer with `aliveCommons` at the cap spawns nothing; and
// the paragraph under it: "When the cap is full the timer rests at `0`, and the
// next spawn lands on the first tick that has room." Row 0 of `SPAWN_WINDOWS`
// reads "| 0 | 0:00 | moth | 1.00 | 20 |", so the cap is 20 and the interval
// `round(1.00 × TICK_HZ)`, 60 ticks.
//
// WHY TWENTY MOTHS. `aliveCommons` is "how many of `enemies` have `rank`
// `common` in `ENEMIES` and are not `gnat`" (specs/instrumentation.md), and the
// moth is a common, so twenty of them read exactly 20 — the cap, not one under
// it. `aliveCommons < cap` is a strict comparison, so a build that wrote "at
// most" spawns a twenty-first here and fails.
//
// WHY 120 TICKS. Two whole intervals, so a build that spawns on its own rhythm
// regardless of the cap has two chances to be caught, and the resting timer is
// read after more ticks than a full count-down would take.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `spawning` alone. The
// twenty moths stand well outside the ring so they are not confused with an
// arrival, and `enemyMotion`, `enemyContact` and `despawning` are all off, so
// none of them moves, hits, or is removed and the count stays exactly 20 for
// the whole span.
//
// THE TOLERANCE. `TIMER_TOL`, the `1e-6` a timer's reading is allowed, against
// the `1.00` a spawn would have set it to. The counts are whole and read
// exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { SPAWN_WINDOWS, TIMER_TOL, dueTicks } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  newEnemies,
  type Harness,
} from "../harness";

/** Row 0's cap and interval. */
const ROW = SPAWN_WINDOWS[0]!;

/** Two whole intervals of row 0. */
const SPAN_TICKS = dueTicks(ROW.interval) * 2;

/** Where the posed commons stand: well outside the spawn ring. */
const FILLER_X = 2000;

/** The gap between them, so no two share a point. */
const FILLER_GAP = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("spawns nothing across 120 ticks with 20 commons alive, and rests the timer at 0", async () => {
  await isolate(h, { on: ["spawning"] });
  for (let held = 0; held < ROW.cap; held += 1) {
    await h.debug.spawnEnemy("moth", FILLER_X + held * FILLER_GAP, 0);
  }
  await h.debug.setSpawnTimer(0);
  const before = await h.snapshot();

  const after = await h.step(SPAN_TICKS);
  await captureStill(h, "capped");

  assertEqual(
    before.run.aliveCommons,
    ROW.cap,
    `aliveCommons with ${ROW.cap} moths posed alive`,
  );
  assertEqual(
    newEnemies(before, after).length,
    0,
    `enemies the director spawned across ${SPAN_TICKS} ticks at the cap`,
  );
  assertNear(
    after.run.spawnTimer,
    0,
    TIMER_TOL,
    `spawnTimer after ${SPAN_TICKS} ticks at the cap`,
  );
});
