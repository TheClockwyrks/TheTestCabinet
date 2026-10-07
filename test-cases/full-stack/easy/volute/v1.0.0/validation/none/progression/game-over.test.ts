// progression/game-over — the run ends with the last cell.
//
// THE SPEC LINE. `specs/progression.md` — "Cells": "A spend that takes the count
// to 0 ends the run in place of restarting the level, so the third arrival is a
// run's last." The screen it ends on is that file's table: "A cell spent taking
// the count to 0 | `gameover` | the run is over".
//
// THE DRIVE. ONE arrival, over a hall posed with one cell left. `setCells`
// (`specs/instrumentation.md`) sets the cells remaining and "ends no run" —
// "`setCells(0)` leaves the screen exactly as it stands, and the ending a spent
// last cell reaches comes from the ticks run after the pose" — so the cell the
// arrival spends is the run's last one and the ending is entirely the build's.
//
// WHY NOT THREE ARRIVALS. Because the two before the last are
// `progression/cell-lost-at-intake`'s requirement. A drive that spent all three
// would fail this point whenever a build's FIRST arrival was wrong, which is a
// defect that already costs that other point, and it would spend three times the
// frames to decide one thing.
//
// TOLERANCES. None: a cell count and a screen name are both exact under the
// standing tolerances. The ceiling on the sweep is a ceiling rather than a
// tolerance, comfortably past the 55 ticks the ride takes at level 1's feed
// speed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureReplay, createHarness, type Harness } from "../harness";
import { driveArrival, type Setback } from "./setback";

/** The cells the hall is posed with, so the arrival spends the run's last. */
const LAST_CELL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ends the run on the gameover screen with no cells left", async () => {
  const setback: Setback = await captureReplay(h, "over", () =>
    driveArrival(h, { cells: LAST_CELL }),
  );

  assertEqual(
    setback.posed.cells,
    LAST_CELL,
    "the cells standing before the arrival",
  );
  assertEqual(setback.spent.cells, 0, "the cells left after the last arrival");
  assertEqual(
    setback.spent.screen,
    "gameover",
    "the screen on the tick the last cell was spent",
  );
});
