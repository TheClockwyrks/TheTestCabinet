// Wick — instrumentation/set-screen-playing-fresh: `setScreen("playing")` from
// `title`, `howto`, `fallen`, or `dawn` begins a fresh run: the idle run with
// Taper at level 1 and cooldown 0 alone in the first weapon slot, `screen`
// `playing`, `menuIndex` `0`.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setScreen(name)`):
// the `playing | any other` row: "Begins a fresh run exactly as `LIGHT THE LAMP`
// and `TRY AGAIN` do: the idle run with Taper at level `1` and cooldown `0` in
// the first weapon slot." specs/ui.md — "A fresh run" lists the same. The idle
// run is specs/state.md's, restated by `idleRun()`, with `FRESH_TAPER` in the
// first slot.
//
// WHY THE WORLD IS POSED AS IT IS. Each of the four screens the row covers is
// entered by its own `setScreen` row, the two end screens from a run that was
// given a clock so the fresh run's `0` is a restart and not a leftover.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  documentedRun,
  FRESH_TAPER,
  idleRun,
  isolate,
  poseScreen,
  type Harness,
} from "../harness";

const ENDED_TICK = 500;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** `setScreen("playing")` from the screen the game stands on, read as a fresh run. */
async function requireFreshRun(from: string): Promise<void> {
  const fresh = await poseScreen(h, "playing");
  assertEqual(fresh.screen, "playing", `the screen after setScreen('playing') from ${from}`);
  assertEqual(fresh.menuIndex, 0, `menuIndex after setScreen('playing') from ${from}`);
  assertDeepEqual(
    documentedRun(fresh.run),
    idleRun([FRESH_TAPER]),
    `the fresh run begun from ${from}`,
  );
}

it("begins a fresh run from title, howto, fallen, and dawn", async () => {
  await h.debug.reset();
  await requireFreshRun("title");

  await h.debug.reset();
  await poseScreen(h, "howto");
  await requireFreshRun("howto");

  await isolate(h);
  await h.debug.setTick(ENDED_TICK);
  await poseScreen(h, "fallen");
  await requireFreshRun("fallen");

  await isolate(h);
  await h.debug.setTick(ENDED_TICK);
  await poseScreen(h, "dawn");
  await requireFreshRun("dawn");
  await captureStill(h, "fresh");
});
