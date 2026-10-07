// instrumentation/set-screen-fallen — `setScreen('fallen')` from playing and
// from paused stands the game on fallen with menuIndex 0, ending nothing.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setScreen`: "Sets
// `screen` to `name`, one of the `Screen` values, with `menuIndex`,
// `almanacTab`, and `almanacScroll` all `0`", and "Applies on every screen".
// The pose ends no run: "a run is never begun, discarded, ended, or grown by
// it", and "the fallen ending is `setHp` at `0` and one tick", which is the
// ending rule of specs/world.md and what `screens/fallen-copy` and the rest of
// the end-screen points drive.
//
// THE POSE. The run is given a clock, a level, and a kill count that are not
// the idle values, and the lamplighter is left at full health, so a build that
// ran its ending rule out of this pose is read on the health it did not take.
// The call is made from both run screens.
//
// THE TOLERANCE. None: a screen name, a menu index, three whole counts, and a
// health the run began with.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BASE_MAX_HP } from "../constants";
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

/** Pose the run's figures, stand on `from`, and pose `fallen` over it. */
function poseFallenFrom(from: "playing" | "paused"): void {
  isolate(h);
  h.debug.setTick(TICK);
  h.debug.setLevel(LEVEL);
  h.debug.setKills(KILLS);
  if (from === "paused") h.debug.setScreen("paused");

  h.debug.setScreen("fallen");
  const fallen = h.snapshot();

  assertEqual(
    fallen.screen,
    "fallen",
    `the screen after setScreen('fallen') from ${from}`,
  );
  assertEqual(fallen.menuIndex, 0, `menuIndex on fallen from ${from}`);
  assertEqual(fallen.run.tick, TICK, `the run's tick from ${from}`);
  assertEqual(fallen.run.level, LEVEL, `the run's level from ${from}`);
  assertEqual(fallen.run.kills, KILLS, `the run's kills from ${from}`);
  assertEqual(
    fallen.run.player.hp,
    BASE_MAX_HP,
    `the health the pose left from ${from}`,
  );
}

it("stands the game on fallen from playing and from paused", async () => {
  poseFallenFrom("playing");
  poseFallenFrom("paused");
  await h.frameDraw();
  captureStill(h, "fallen");
});
