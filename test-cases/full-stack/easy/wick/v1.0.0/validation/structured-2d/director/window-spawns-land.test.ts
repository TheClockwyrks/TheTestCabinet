// director/window-spawns-land — the director puts something on the field.
//
// THE SPEC LINE. `specs/enemies.md`, "The spawn timer": "On every tick
// `spawning` is on ... if `spawnTimer` is due and `aliveCommons` < cap: spawn
// one enemy of a type chosen uniformly from the window's types, at a spawn
// point"; and "A spawn therefore lands on the first tick of a run, on the
// first tick of every window, and every `interval` seconds between."
// `specs/state.md` gives a fresh run `spawnTimer` `0`, and window `0`'s row
// gives an interval of `1.00` seconds with a cap of `20`.
//
// WHAT THIS ITEM DECIDES, AND WHAT IT LEAVES TO THE OTHERS. Only that the
// director spawns AT ALL — the broadest failure in this category, and the one
// that makes the game unplayable, since nothing else in the night happens
// without enemies. Which type, at what distance, on exactly which tick, and
// how often are each their own item.
//
// THE DRIVE. The isolated world of `isolate` — a fresh `playing` run holding
// nothing, every switch off — with `spawning` alone turned back on. The clock
// stays at `0`, so the window is `0` and the cap of `20` is far from met with
// nothing alive. `120` ticks is two whole intervals of that window, so a build
// that spawns on any schedule at all lands something inside it; only a build
// that spawns nothing runs the budget out.
//
// THE TOLERANCE. None to give: an enemy is on the field or it is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertTrue } from "../assert";
import { SPAWN_WINDOWS, TICK_HZ } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";

/** Two whole intervals of window 0, as the item's budget. */
const BUDGET_TICKS = 2 * Math.round(SPAWN_WINDOWS[0].interval * TICK_HZ);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("puts an enemy on the field within the first 120 ticks of a run with spawning on", async () => {
  isolate(h);
  enable(h, "spawning");

  const found = await h.until((s) => s.run.enemies.length > 0, {
    maxTicks: BUDGET_TICKS,
  });
  captureStill(h, "spawned");

  assertTrue(
    found.hit,
    `an enemy on the field within ${BUDGET_TICKS} ticks of a run with spawning on`,
  );
  assertGreaterThanOrEqual(
    found.snapshot.run.enemies.length,
    1,
    "the enemies alive on the tick the director first spawned",
  );
});
