// presentation/hud-level — the level readout carries its label, the level being
// played, and the eight levels a run is.
//
// specs/ui.md's HUD table gives the third readout "`HUD_LEVEL_LABEL` (`LEVEL`),
// the current `level`, and `TOTAL_LEVELS` (`8`)", inside the bar specs/strait.md
// puts at `y` in `[0, HUD_H]`. All three parts are read here, because each is a
// thing a player needs and a build can drop any one of them on its own: the label
// says which figure this is, the level says where the run stands, and the total is
// what makes the level mean anything.
//
// TWO LEVELS ARE READ, BOTH AWAY FROM THE DEFAULT. `setLevel` is what a level is
// (specs/instrumentation.md), and reading the bar at `5` and then at `6` — rather
// than at the `1` a fresh run opens on — is what tells a readout that FOLLOWS
// `level` from one that draws the opening level forever, from one that draws the
// label alone, and from one that draws some other level's figure and never moves.
//
// NO OTHER READOUT OF EITHER CROSSING CAN SUPPLY THOSE FIGURES. `startCrossing`
// poses the score at `0` and the lives at `3`, and the crossing timer is `22`
// seconds at level 5 and `20` at level 6 (`crossingTimer`), so `5`, `6` and `8`
// appear in the bar only if the level readout drew them. The lanes `setLevel` lays
// out are cleared straight after by `startCrossing`, so nothing is moving while
// either frame is read.

import { afterEach, beforeEach, it } from "vitest";
import { HUD_LEVEL_LABEL, TOTAL_LEVELS } from "../../src/constants";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  drawFrame,
  startCrossing,
  type Harness,
} from "../harness";
import { describeRuns, hudRuns, runsShowing } from "./readout";

/** The two levels posed: neither the one a fresh run opens on, nor the total. */
const FIRST_LEVEL = 5;
const SECOND_LEVEL = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the label, the current level and the total in the HUD bar", async () => {
  /** The bar read on a fresh crossing posed at `level`, with all three parts. */
  const readBarAt = async (level: number, capture: boolean): Promise<void> => {
    startCrossing(h, level);
    const runs = hudRuns(h, await drawFrame(h));
    // Taken from the first of the two frames, and before any assertion, so a
    // failing verdict still leaves the readout that produced it.
    if (capture) captureStill(h, "hud");

    // The situation: the crossing really is at the level this reading is about.
    assertEqual(h.snapshot().level, level, "the posed level (specs/state.md)");

    const label = HUD_LEVEL_LABEL.toLowerCase();
    assertGreaterThanOrEqual(
      runs.filter((run) => run.text.toLowerCase().includes(label)).length,
      1,
      `a run inside the HUD bar carrying HUD_LEVEL_LABEL (${HUD_LEVEL_LABEL}) ` +
        `at level ${level} (specs/ui.md) — the bar drew ${describeRuns(runs)}`,
    );
    assertGreaterThanOrEqual(
      runsShowing(runs, level).length,
      1,
      `a run inside the HUD bar reading ${level}, the level being played ` +
        `(specs/ui.md) — the bar drew ${describeRuns(runs)}`,
    );
    assertGreaterThanOrEqual(
      runsShowing(runs, TOTAL_LEVELS).length,
      1,
      `a run inside the HUD bar reading TOTAL_LEVELS (${TOTAL_LEVELS}), the ` +
        `levels a run is (specs/ui.md), at level ${level} — the bar drew ` +
        `${describeRuns(runs)}`,
    );
  };

  await readBarAt(FIRST_LEVEL, true);
  await readBarAt(SECOND_LEVEL, false);
});
