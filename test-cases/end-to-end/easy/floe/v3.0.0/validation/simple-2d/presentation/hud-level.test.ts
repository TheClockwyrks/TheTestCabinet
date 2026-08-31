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
// THE LEVEL IS POSED AWAY FROM THE DEFAULT. `setLevel` is what a level is
// (specs/instrumentation.md), and posing `5` rather than reading the `1` a fresh
// run opens on is what tells a readout that follows `level` from one that draws
// the opening level, or the label alone, forever.
//
// NO OTHER READOUT OF THIS CROSSING CAN SUPPLY THOSE FIGURES. `startCrossing`
// poses the score at `0` and the lives at `3`, and the level-5 crossing timer is
// `22` seconds (`crossingTimer`), so `5` and `8` appear in the bar only if the
// level readout drew them. The lanes `setLevel` lays out are cleared straight
// after by `startCrossing`, so nothing is moving while the frame is read.

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

/** The level posed: not the one a fresh run opens on, and not the total. */
const LEVEL = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the label, the current level and the total in the HUD bar", async () => {
  startCrossing(h, LEVEL);

  const runs = hudRuns(h, await drawFrame(h));
  captureStill(h, "hud");

  // The situation: the crossing really is at the level this reading is about.
  assertEqual(h.snapshot().level, LEVEL, "the posed level (specs/state.md)");

  const label = HUD_LEVEL_LABEL.toLowerCase();
  assertGreaterThanOrEqual(
    runs.filter((run) => run.text.toLowerCase().includes(label)).length,
    1,
    `a run inside the HUD bar carrying HUD_LEVEL_LABEL (${HUD_LEVEL_LABEL}) ` +
      `(specs/ui.md) — the bar drew ${describeRuns(runs)}`,
  );
  assertGreaterThanOrEqual(
    runsShowing(runs, LEVEL).length,
    1,
    `a run inside the HUD bar reading ${LEVEL}, the level being played ` +
      `(specs/ui.md) — the bar drew ${describeRuns(runs)}`,
  );
  assertGreaterThanOrEqual(
    runsShowing(runs, TOTAL_LEVELS).length,
    1,
    `a run inside the HUD bar reading TOTAL_LEVELS (${TOTAL_LEVELS}), the ` +
      `levels a run is (specs/ui.md) — the bar drew ${describeRuns(runs)}`,
  );
});
