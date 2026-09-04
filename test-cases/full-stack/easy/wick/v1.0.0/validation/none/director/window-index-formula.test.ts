// director/window-index-formula — `spawnWindow` is
// `min(19, floor(time / SPAWN_WINDOW))`.
//
// WHERE THE THRESHOLD COMES FROM. specs/enemies.md ("Windows"): "The night is
// divided into windows of `SPAWN_WINDOW` (`30`) seconds, and the current
// window's index is `min(19, floor(time / SPAWN_WINDOW))`, from `0` to `19`."
// specs/instrumentation.md reports it under the same formula, "`spawnWindow` |
// `min(19, floor(time / SPAWN_WINDOW))`, with `SPAWN_WINDOW` (`30`)", over a
// clock that is "`time` | `tick / TICK_HZ`".
//
// THE FOUR TICKS ARE THE FORMULA'S EDGES. 1799 is the last tick of window 0,
// `1799 / 60 / 30` being just under 1, and 1800 the first of window 1, exactly
// 1: a build that rounded rather than floored, or that counted the boundary
// into the window below, separates the pair. 17999 reads 9 rather than the 10
// its own boundary at 18000 would begin, which is the same edge a long way up
// the night. 35999 is the greatest tick `setTick` accepts
// (specs/instrumentation.md: "a whole number from `0` to
// `DAWN_TIME × TICK_HZ − 1` (`35999`)"), whose quotient is `19.99`, and it reads
// 19 — the `min` and the `floor` agreeing on the last window rather than a
// twentieth appearing.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with every faculty held.
// The index is derived from the clock alone, and `setTick` "Sets `tick` to
// `tick` ... Nothing else changes", so each reading is of the posed clock and
// of nothing the ticks between could have done. No tick is run, because a tick
// would move the clock off the figure being read.
//
// THE TOLERANCE. A whole index, read exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { MAX_POSED_TICK, spawnWindowIndex, TICK_HZ } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

/** The four clocks read: two either side of a boundary, and two far up. */
const TICKS = [1799, 1800, 17999, MAX_POSED_TICK];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads 0 at tick 1799, 1 at 1800, 9 at 17999 and 19 at 35999", async () => {
  await isolate(h);

  const read: number[] = [];
  for (const tick of TICKS) {
    await h.debug.setTick(tick);
    read.push((await h.snapshot()).run.spawnWindow);
  }
  await captureStill(h, "index");

  for (const [at, tick] of TICKS.entries()) {
    assertEqual(
      read[at],
      spawnWindowIndex(tick / TICK_HZ),
      `spawnWindow with the clock posed to tick ${tick}`,
    );
  }
});
