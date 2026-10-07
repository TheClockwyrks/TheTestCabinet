// director/window-index-formula — the window index the clock gives.
//
// THE SPEC LINE. `specs/enemies.md`, "Windows": "The night is divided into
// windows of `SPAWN_WINDOW` (`30`) seconds, and the current window's index is
// `min(19, floor(time / SPAWN_WINDOW))`, from `0` to `19`." `specs/world.md`
// makes `time` "`tick / TICK_HZ` seconds", and
// `specs/instrumentation.md` ("Snapshot shape") derives the reported field the
// same way: `spawnWindow` from "`min(19, floor(time / SPAWN_WINDOW))`".
//
// THE FOUR CLOCKS, AND WHAT EACH ONE CATCHES. Tick 1799 (`29.983` s) is the
// last tick of window 0 and tick 1800 (`30` s) the first of window 1: the pair
// pins the floor's edge, which a build that rounds instead of flooring misses.
// Tick 17999 (`299.983` s) reads 9, a window in the middle of the table, which
// a build with an off-by-one row misses. Tick 35999 (`599.983` s) is the last
// tick `setTick` accepts ("`0` to `DAWN_TIME × TICK_HZ − 1`") and reads 19: the
// `min` holds it at the last row, which a build without the clamp overruns.
//
// WHY NO TICK IS DRIVEN BETWEEN THE READS. `setTick` sets the clock and
// "everything derived from the clock, `time`, `spawnWindow`, ... follows",
// and `snapshot()` is "A pure read of the state ... It changes nothing" — so
// each reading is taken off the posed clock alone, with no spawn, no event,
// and no ending in the way. The one frame at the end is there to leave the
// picture the item carries, after every reading has been taken.
//
// THE TOLERANCE. None: a window index is a whole number the formula fixes.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SPAWN_WINDOW, TICK_HZ } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

/** The clocks read, each with the index `min(19, floor(time / 30))` gives. */
const READINGS: readonly (readonly [tick: number, window: number])[] = [
  [1799, 0],
  [1800, 1],
  [17999, 9],
  [35999, 19],
];

/** The clock the closing frame is posed at, one of the four read above. */
const PICTURE_TICK = SPAWN_WINDOW * TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads spawnWindow 0, 1, 9, and 19 at ticks 1799, 1800, 17999, and 35999", async () => {
  isolate(h);

  const read = READINGS.map(([tick]) => {
    h.debug.setTick(tick);
    return h.snapshot().run.spawnWindow;
  });

  h.debug.setTick(PICTURE_TICK);
  await h.advance(1);
  captureStill(h, "index");

  for (const [index, [tick, window]] of READINGS.entries()) {
    assertEqual(
      read[index],
      window,
      `spawnWindow with the clock at tick ${tick}`,
    );
  }
});
