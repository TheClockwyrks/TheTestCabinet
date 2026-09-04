// Wick — instrumentation/set-screen-dawn: `setScreen("dawn")` on `playing` or
// `paused` ends the run exactly as dawn does: `screen` `dawn` with `menuIndex`
// `0` and the run kept for the end screen to report.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setScreen(name)`):
// the `fallen, dawn | playing, paused` row: "Ends the run exactly as that
// ending does, the run kept for the end screen to report." specs/ui.md: the
// end screens show "The run clock at the end", "The level reached", and "The
// kill count"; `run` "reports ... the run that just ended on `fallen` and
// `dawn`" (specs/instrumentation.md).
//
// WHY THE WORLD IS POSED AS IT IS. The run is given a clock, a level, and a
// kill count that are not the idle values, so "kept" is told from "discarded";
// the call is made from both screens the row lists.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  poseScreen,
  type Harness,
} from "../harness";

const TICK = 500;
const LEVEL = 4;
const KILLS = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Pose the run's figures, enter `from`, and end the run at dawn. */
async function endDawnFrom(from: "playing" | "paused"): Promise<void> {
  await isolate(h);
  await h.debug.setTick(TICK);
  await h.debug.setLevel(LEVEL);
  await h.debug.setKills(KILLS);
  if (from === "paused") await poseScreen(h, "paused");
  const dawn = await poseScreen(h, "dawn");
  assertEqual(
    dawn.screen,
    "dawn",
    `the screen after setScreen('dawn') from ${from}`,
  );
  assertEqual(dawn.menuIndex, 0, `menuIndex on dawn from ${from}`);
  assertEqual(dawn.run.tick, TICK, `the ended run's tick from ${from}`);
  assertEqual(dawn.run.level, LEVEL, `the ended run's level from ${from}`);
  assertEqual(dawn.run.kills, KILLS, `the ended run's kills from ${from}`);
  assertEqual(dawn.accumulator, 0, `the accumulator on dawn from ${from}`);
}

it("ends the run at dawn from playing and from paused, keeping the run", async () => {
  await endDawnFrom("playing");
  await endDawnFrom("paused");
  await captureStill(h, "dawn");
});
