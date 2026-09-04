// progression/game-over — the run ends with the last cell.
//
// THE SPEC LINE. `specs/progression.md` — "Cells": "A run starts with 3 cells"
// (`CELLS`), and "A spend that takes the count to 0 ends the run in place of
// restarting the level, so the third arrival is a run's last." The screen it ends
// on is that file's table: "A cell spent taking the count to 0 | `gameover` | the
// run is over".
//
// THE DRIVE. Three arrivals in turn. Each is the same isolated hall
// `progression/cell-lost-at-intake` poses — level 1 with its quota spent and ONE
// core 20 units short of the intake — and each is driven until the cell count
// moves. Between them the level is opened again, which `specs/instrumentation.md`
// defines as leaving the run's own figures alone: "The score and the cells stay
// as they are." So the three spends are three spends of the same run, and nothing
// but the arrivals touches the count.
//
// WHY THE FIRST TWO ARE CHECKED TOO. Not as their own claim — that a single
// arrival spends a cell is `progression/cell-lost-at-intake` — but because the
// third arrival is only the last one if the two before it landed. A drive whose
// first core never reached the intake would otherwise read as a build that ends
// its run too early.
//
// TOLERANCES. None: a cell count and a screen name are both exact under the
// standing tolerances. The 90-tick ceiling on each sweep is a ceiling rather than
// a tolerance, comfortably past the 55 ticks the ride takes at level 1's feed
// speed and inside the 120 ticks of the interlude a spend opens.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { CELLS, INTAKE_S } from "../constants";
import {
  captureReplay,
  createHarness,
  poseHall,
  type Harness,
  type UntilResult,
} from "../harness";

/** Where each arriving core is posed: 20 units short of the intake. */
const POSED_S = INTAKE_S - 20;

/** Comfortably past the 55 ticks the ride takes, and inside the 2 s interlude. */
const MAX_TICKS = 90;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Pose one arriving core and step until the run's cell count moves. */
async function driveArrival(cellsBefore: number): Promise<UntilResult> {
  await poseHall(h, {
    level: 1,
    quotaRemaining: 0,
    pressure: 0,
    cores: [[POSED_S, "halide", null]],
  });
  return h.stepUntil((snapshot) => snapshot.cells !== cellsBefore, {
    maxTicks: MAX_TICKS,
    poll: 1,
  });
}

it("ends the run on the gameover screen with no cells left", async () => {
  const opened = h.snapshot();
  assertEqual(opened.cells, CELLS, "the cells a fresh run opens with");

  // The two arrivals the run survives, so the third is the one under test.
  let cells = opened.cells;
  for (let spend = 1; spend < CELLS; spend += 1) {
    const swept = await driveArrival(cells);
    assertTrue(swept.hit, `a cell spent on arrival ${spend} of ${CELLS}`);
    cells = swept.snapshot.cells;
    assertEqual(cells, CELLS - spend, `the cells left after arrival ${spend}`);
  }

  const last = await captureReplay(h, "over", () => driveArrival(cells));

  assertTrue(last.hit, `a cell spent on arrival ${CELLS} of ${CELLS}`);
  assertEqual(last.snapshot.cells, 0, "the cells left after the last arrival");
  assertEqual(
    last.snapshot.screen,
    "gameover",
    "the screen on the tick the last cell was spent",
  );
});
