// progression/game-over — the run ends with the last cell.
//
// THE SPEC LINE. `specs/progression.md` — "Cells": "A spend that takes the count
// to 0 ends the run in place of restarting the level, so the third arrival is a
// run's last." The screen it ends on is that file's table: "A cell spent taking
// the count to 0 | `gameover` | the run is over".
//
// THE DRIVE. One arrival, over a run standing on its LAST cell. The cells are
// posed at 1 through `setCells`, which `specs/instrumentation.md` says "sets the
// cells remaining to `n` ... Neither ends a run or opens one: `setCells(0)`
// leaves the screen exactly as it stands, and the ending a spent last cell
// reaches comes from the ticks run after the pose." So the pose puts the run one
// arrival from its end and decides nothing; the ending is the game's.
//
// WHY ONE ARRIVAL AND NOT THREE. What this point decides is what the LAST spend
// does. Driving three real arrivals to reach it would fold
// `progression/cell-lost-at-intake`'s requirement into this one — a build whose
// first arrival spends no cell would fail here for a reason this point does not
// own — and would spend three times the frames.
//
// THE HALL. Level 1, one core posed 20 units short of the intake, the inlet held
// by `poseHall` and the quota left part-spent, so nothing arrives to join the
// scenario and the channel the spend empties does not clear the level.
//
// TOLERANCES. None: a cell count and a screen name are both exact under the
// standing tolerances. The 90-tick ceiling on the sweep is a ceiling rather than
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
} from "../harness";

/** Where the arriving core is posed: 20 units short of the intake. */
const POSED_S = INTAKE_S - 20;

/** The cells the run stands on, so the arrival that follows is its last. */
const LAST_CELL = 1;

/** Comfortably past the 55 ticks the ride takes at level 1's feed speed. */
const MAX_TICKS = 90;

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
    cells: LAST_CELL,
    cores: [[POSED_S, "halide", null]],
  });

  const posed = await h.snapshot();
  assertEqual(
    posed.cells,
    LAST_CELL,
    "the cells the run was posed standing on",
  );
  assertEqual(
    posed.screen,
    "playing",
    "the screen the pose left, which setCells does not decide",
  );

  const last = await captureReplay(h, "over", () =>
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
