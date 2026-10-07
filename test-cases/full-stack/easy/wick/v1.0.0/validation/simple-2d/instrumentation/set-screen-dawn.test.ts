// instrumentation/set-screen-dawn — `setScreen('dawn')` from playing and from
// paused stands the game on dawn with menuIndex 0, ending nothing.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setScreen`: "Sets
// `screen` to `name`, one of the `Screen` values, with `menuIndex`,
// `almanacTab`, and `almanacScroll` all `0`", and "Applies on every screen".
// The pose ends no run: "a run is never begun, discarded, ended, or grown by
// it", and "the dawn ending is `setTick` at `DAWN_TIME × TICK_HZ − 1` (`35999`)
// and one tick", which is the ending rule of specs/world.md and what
// `screens/dawn-copy` and the rest of the end-screen points drive.
//
// THE POSE. The run is given a clock well short of dawn, a level, and a kill
// count that are not the idle values, so a build that ran its ending rule out
// of this pose is read on the clock it did not reach. The call is made from
// both run screens.
//
// THE TOLERANCE. None: a screen name, a menu index, and three whole counts.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

const TICK = 500;
const LEVEL = 4;
const KILLS = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Pose the run's figures, stand on `from`, and pose `dawn` over it. */
function poseDawnFrom(from: "playing" | "paused"): void {
  isolate(h);
  h.debug.setTick(TICK);
  h.debug.setLevel(LEVEL);
  h.debug.setKills(KILLS);
  if (from === "paused") h.debug.setScreen("paused");

  h.debug.setScreen("dawn");
  const dawn = h.snapshot();

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
  poseDawnFrom("playing");
  poseDawnFrom("paused");
  await h.frameDraw();
  captureStill(h, "dawn");
});
