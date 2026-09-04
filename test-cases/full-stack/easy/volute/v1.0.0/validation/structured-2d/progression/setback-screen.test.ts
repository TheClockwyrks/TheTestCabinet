// progression/setback-screen — a cell spent with cells remaining shows the
// `setback` screen.
//
// THE SPEC LINE. `specs/progression.md` — "Interludes and endings", one row of
// the table that names the screen each event reaches:
//
//   | A cell spent with cells remaining | `setback` | the same level, after the
//     interlude |
//
// It is a row nothing else decides. `progression/cell-lost-at-intake` decides
// that the arrival spends a cell, `progression/game-over` decides the screen the
// LAST cell reaches, and the four `progression/setback-*` points decide the
// figures the spend restores — but the screen a spend with cells left reaches is
// its own reading, and a build that sets the run back correctly while holding the
// game on `playing`, or that shows `gameover` on every spend, fails here alone.
//
// THE POSE. Level 1 with one core 20 units short of the intake, on a run that has
// spent nothing: `specs/progression.md` gives a run 3 cells, so the arrival is the
// FIRST of three and cells certainly remain after it. The inlet is held
// (`specs/instrumentation.md`, `setEmission`) and the quota is a level start's, so
// nothing joins the scenario and the level cannot clear instead.
//
// THE READING is taken on the tick the cell count moves, which
// `specs/channel.md`'s order of a tick (step 6) makes the tick the screen changes
// on. The cells left are read too, but only to say which row of the table the
// spend was: a spend that took the count to 0 would be the row below.
//
// THE TOLERANCE. None: a screen name and a cell count are both exact under the
// standing tolerances. The 120-tick ceiling is a ceiling rather than a tolerance,
// comfortably past the 55 ticks the ride takes at level 1's feed speed and inside
// the 120 ticks of the interlude a spend opens.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import { CELLS, INTAKE_S } from "../constants";
import {
  captureReplay,
  createHarness,
  poseHall,
  type Harness,
} from "../harness";

/** Where the arriving core is posed: 20 units short of the intake. */
const POSED_S = INTAKE_S - 20;

/** Comfortably past the 55 ticks the ride takes, and inside the 2 s interlude. */
const MAX_TICKS = 120;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves to the setback screen when a cell is spent with cells remaining", async () => {
  await poseHall(h, {
    level: 1,
    pressure: 0,
    cores: [[POSED_S, "halide", null]],
  });

  const opened = h.snapshot();
  assertEqual(
    opened.cells,
    CELLS,
    "the cells the run stands on before the spend",
  );
  assertEqual(opened.screen, "playing", "the screen the arrival is driven on");

  const swept = await captureReplay(h, "setback", () =>
    h.stepUntil((snapshot) => snapshot.cells !== opened.cells, {
      maxTicks: MAX_TICKS,
      poll: 1,
    }),
  );

  assertTrue(
    swept.hit,
    `a cell spent within ${MAX_TICKS} ticks of a core posed ` +
      `${INTAKE_S - POSED_S} units short of the intake`,
  );
  // Which row of the table this spend was: one with cells still remaining.
  assertGreaterThan(
    swept.snapshot.cells,
    0,
    "the cells left after the spend, so this is a spend the run survives",
  );
  assertEqual(
    swept.snapshot.screen,
    "setback",
    "the screen on the tick a cell was spent with cells remaining",
  );
});
