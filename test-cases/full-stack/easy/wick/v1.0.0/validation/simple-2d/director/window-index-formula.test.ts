// director/window-index-formula — the window index the snapshot reports is
// `min(19, floor(time / SPAWN_WINDOW))`.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("Windows"): "The night is divided into windows of
//     `SPAWN_WINDOW` (`30`) seconds, and the current window's index is
//     `min(19, floor(time / SPAWN_WINDOW))`, from `0` to `19`."
//   - `specs/instrumentation.md` ("Snapshot shape"): `spawnWindow` is derived
//     from "`min(19, floor(time / SPAWN_WINDOW))`, with `SPAWN_WINDOW` (`30`)",
//     and `time` from "`tick / TICK_HZ`".
//   - `specs/instrumentation.md` (`setTick`): "Sets `tick` to `tick`, a whole
//     number from `0` to `DAWN_TIME × TICK_HZ − 1` (`35999`) ... everything
//     derived from the clock, `time`, `spawnWindow` ... follows".
//
// WHAT IS READ. Four clocks, each posed and read without a tick: 1799, the last
// tick of window 0; 1800, the first of window 1; 17999, the last of window 9;
// and 35999, the last tick of the night, where the floor would give 19 and the
// minimum holds it there. The four are the two boundaries the formula can be
// got wrong at, either side of one edge and at the last window.
//
// WHY THE NIGHT IS POSED AS IT IS. Nothing but the clock: every switch is off
// and the field is empty, so the index read is the formula applied to the
// posed tick and nothing else. A partial frame draws the last of the four for
// the evidence without consuming a tick, which would move the clock the reading
// is about.
//
// TOLERANCE. None: the index is a whole number the formula fixes.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { spawnWindowAt, TICK_DT } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

/** The clocks read, and the index the formula gives each. */
const READINGS: readonly (readonly [number, number])[] = [
  [1799, 0],
  [1800, 1],
  [17999, 9],
  [35999, 19],
];

/** A frame short of a whole tick: it draws and consumes no tick. */
const PARTIAL_FRAME = TICK_DT / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads the window index the formula gives at each clock", async () => {
  isolate(h);

  const read: number[] = [];
  for (const [tick] of READINGS) {
    h.debug.setTick(tick);
    read.push(h.snapshot().run.spawnWindow);
  }
  await h.frameOf(PARTIAL_FRAME);
  captureStill(h, "index");

  READINGS.forEach(([tick, index], at) => {
    assertEqual(index, spawnWindowAt(tick * TICK_DT), `the formula at ${tick}`);
    assertEqual(read[at], index, `the window index reported at tick ${tick}`);
  });
});
