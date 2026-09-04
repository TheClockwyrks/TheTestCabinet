// progression/game-over — the run ends with the last cell.
//
// THE SPEC LINE. `specs/progression.md` — "Cells": "A run starts with 3 cells"
// (`CELLS`), and "A spend that takes the count to 0 ends the run in place of
// restarting the level, so the third arrival is a run's last." The screen it ends
// on is that file's table: "A cell spent taking the count to 0 | `gameover` | the
// run is over".
//
// THE DRIVE. ONE arrival, on a run standing on its last cell.
// `specs/instrumentation.md` (`setCells`) poses the count directly — "sets the
// cells remaining to `n` ... Neither ends a run or opens one: `setCells(0)`
// leaves the screen exactly as it stands, and the ending a spent last cell
// reaches comes from the ticks run after the pose" — so the ending this point
// decides comes from the arrival and from nothing the pose did.
//
// WHY THAT MATTERS. Driving three real arrivals in turn would put
// `progression/cell-lost-at-intake`'s requirement inside this point's failure
// modes: a build whose FIRST arrival never spent a cell would fail here as well
// as there, and the grade could not say which rule it missed. One posed cell and
// one arrival leave this point deciding one thing — that the spend which takes
// the count to 0 ends the run on `gameover` rather than restarting the level.
//
// THE HALL is the isolated one every arrival point poses: level 1 with one core
// 20 units short of the intake, the inlet held (`specs/instrumentation.md`,
// `setEmission`) and the quota a level start's, so nothing joins the scenario and
// the level cannot clear instead.
//
// TOLERANCES. None: a cell count and a screen name are both exact under the
// standing tolerances. The 120-tick ceiling on the sweep is a ceiling rather than
// a tolerance, comfortably past the 55 ticks the ride takes at level 1's feed
// speed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { INTAKE_S } from "../constants";
import {
  captureReplay,
  createHarness,
  poseHall,
  type Harness,
  type UntilResult,
} from "../harness";

/** Where the arriving core is posed: 20 units short of the intake. */
const POSED_S = INTAKE_S - 20;

/** The cells the run is posed on: its last, so this arrival is the run's last. */
const LAST_CELL = 1;

/** Comfortably past the 55 ticks the ride takes at level 1's feed speed. */
const MAX_TICKS = 120;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ends the run on the gameover screen with no cells left", async () => {
  await poseHall(h, {
    level: 1,
    pressure: 0,
    cores: [[POSED_S, "halide", null]],
  });
  h.debug.setCells(LAST_CELL);

  const posed = h.snapshot();
  assertEqual(posed.cells, LAST_CELL, "the last cell the run stands on");
  assertEqual(
    posed.screen,
    "playing",
    "the screen the pose left, which setCells does not move",
  );

  const last: UntilResult = await captureReplay(h, "over", () =>
    h.stepUntil((snapshot) => snapshot.cells !== LAST_CELL, {
      maxTicks: MAX_TICKS,
      poll: 1,
    }),
  );

  assertTrue(
    last.hit,
    `a cell spent within ${MAX_TICKS} ticks of a core posed ` +
      `${INTAKE_S - POSED_S} units short of the intake`,
  );
  assertEqual(last.snapshot.cells, 0, "the cells left after the last arrival");
  assertEqual(
    last.snapshot.screen,
    "gameover",
    "the screen on the tick the last cell was spent",
  );
});
