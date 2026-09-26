// director/window-17 — row 17 of `SPAWN_WINDOWS`.
// From 8:30 the director spawns one of shade, hound, bat every 0.15 s, up
// to 190 commons alive.
//
// WHERE THE THRESHOLD COMES FROM. specs/enemies.md ("Windows") holds the row
// itself, "| 17 | 8:30 | shade, hound, bat | 0.15 | 190 |",
// in a table that is "`SPAWN_WINDOWS`", holding "one row per window in this
// order, each with the types a spawn chooses from, the seconds between spawns,
// and the most common enemies that may be alive for the director to add
// another". The window
// is reached by the clock: "The night is divided into windows of `SPAWN_WINDOW`
// (`30`) seconds, and the current window's index is `min(19, floor(time /
// SPAWN_WINDOW))`", so this row governs from tick 30600 to tick 32399.
//
// THE CADENCE. specs/world.md ("Timers"): "An interval of `s` seconds anywhere
// in this specification is likewise `round(s × TICK_HZ)` ticks", so this row's
// `0.15` is 9 ticks. A timer posed to `0` is due at once, so spawns land on
// the 1st, 10th and 19th ticks of the run and on none between, by the order
// specs/enemies.md ("The spawn timer") fixes.
//
// THE OTHER TWO FIGURES come off the same row through the director's own rule,
// "spawn one enemy of a type chosen uniformly from the window's types, at a
// spawn point" and "if spawnTimer is due and aliveCommons < cap", with
// "`interval` and `cap` ... the current window's" and `aliveCommons` "the
// number of live enemies of rank `common` other than gnats"
// (specs/instrumentation.md).
//
// THE DRIVE. `director/windows.ts` states it in full: the clock posed to the
// window's first tick with `spawning` alone, the cadence read over two whole
// intervals, each of the row's types posed through `setNextSpawnType` and read
// off the spawn the next due tick lands, six unposed spawns drawn one per tick
// with the field cleared between, and then the cap posed full with 190
// commons for two more intervals.
//
// THE TOLERANCE. The cadence and the counts are whole ticks and whole enemies,
// read exactly. The resting timer is `TIMER_TOL`, the `1e-6` a timer's reading
// is allowed, against the `0.15` a spawn would have set it to.

import { afterEach, beforeEach, it } from "vitest";
import { captureReplay, createHarness, type Harness } from "../harness";
import { assertWindow, readWindow } from "./windows";

/** The row this check reads. */
const WINDOW = 17;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("spawns shade, hound, bat every 0.15 s up to 190 alive", async () => {
  const reading = await readWindow(h, WINDOW, (scenario) =>
    captureReplay(h, "window", scenario),
  );

  assertWindow(WINDOW, reading);
});
