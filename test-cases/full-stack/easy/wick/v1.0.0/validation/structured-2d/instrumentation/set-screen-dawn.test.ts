// Wick — instrumentation/set-screen-dawn: `setScreen('dawn')` on `playing` or
// `paused` ends the run at dawn, the run kept for the end screen.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, the
// `setScreen` table, row `fallen`, `dawn` from `playing`, `paused`: "Ends the
// run exactly as that ending does, the run kept for the end screen to report",
// with `menuIndex` `0`. `specs/state.md`: "The `fallen` and `dawn` screens keep
// the run that just ended".
//
// THE POSES. An isolated run with its tick, level, and kills posed to figures
// apart from the idle run's, once from `playing` and once from `paused`; each
// time the whole `run` before is compared with the whole `run` after.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  placeEnemy,
  poseScreen,
  type Harness,
} from "../harness";

const POSED_TICK = 1234;
const POSED_LEVEL = 6;
const POSED_KILLS = 17;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

function poseRun(): void {
  isolate(h, { level: POSED_LEVEL });
  h.debug.setTick(POSED_TICK);
  h.debug.setKills(POSED_KILLS);
  placeEnemy(h, "moth", 300, 0);
}

it("ends the run at dawn from playing and from paused, keeping the run", async () => {
  for (const from of ["playing", "paused"] as const) {
    poseRun();
    // `setScreen("playing")` on `playing` would begin a fresh run (the "any
    // other" row), so the run is posed on `playing` and only `paused` is
    // entered through the surface.
    const before = from === "paused" ? poseScreen(h, "paused") : h.snapshot();
    assertEqual(before.screen, from, "screen before the pose");

    h.debug.setScreen("dawn");
    const after = h.snapshot();
    if (from === "paused") {
      await h.frameDraw();
      captureStill(h, "dawn");
    }

    assertEqual(
      after.screen,
      "dawn",
      `screen after setScreen('dawn') from ${from}`,
    );
    assertEqual(
      after.menuIndex,
      0,
      `menuIndex after setScreen('dawn') from ${from}`,
    );
    assertEqual(after.run.tick, POSED_TICK, `run.tick kept from ${from}`);
    assertEqual(after.run.level, POSED_LEVEL, `run.level kept from ${from}`);
    assertEqual(after.run.kills, POSED_KILLS, `run.kills kept from ${from}`);
    assertDeepEqual(after.run, before.run, `run kept on dawn from ${from}`);
  }
});
