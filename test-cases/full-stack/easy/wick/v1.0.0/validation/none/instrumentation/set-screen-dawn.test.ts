// Wick — instrumentation/set-screen-dawn: `setScreen("dawn")` from `playing`
// and from `paused` stands the game on `dawn` with `menuIndex` `0`, ending
// nothing.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setScreen(name)`):
// "Sets `screen` to `name`, one of the `Screen` values, with `menuIndex`,
// `almanacTab`, and `almanacScroll` all `0`", and "Applies on every screen".
// The pose ends no run: "a run is never begun, discarded, ended, or grown by
// it", and "the dawn ending is `setTick` at `DAWN_TIME x TICK_HZ - 1` (`35999`)
// and one tick", which is the ending rule of specs/world.md and what
// `screens/dawn-copy` and the rest of the end-screen points drive.
//
// WHY THE WORLD IS POSED AS IT IS. The run is given a clock well short of dawn,
// a level, and a kill count that are not the idle values, so a build that ran
// its ending rule out of this pose is read on the clock it did not reach. The
// call is made from both run screens.

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

/** Pose the run's figures, stand on `from`, and pose `dawn` over it. */
async function poseDawnFrom(from: "playing" | "paused"): Promise<void> {
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
  assertEqual(dawn.run.tick, TICK, `the run's tick from ${from}`);
  assertEqual(dawn.run.level, LEVEL, `the run's level from ${from}`);
  assertEqual(dawn.run.kills, KILLS, `the run's kills from ${from}`);
}

it("stands the game on dawn from playing and from paused", async () => {
  await poseDawnFrom("playing");
  await poseDawnFrom("paused");
  await captureStill(h, "dawn");
});
