// Wick — instrumentation/set-screen-playing-fresh: `setScreen('playing')` from
// `title`, `howto`, `fallen`, or `dawn` begins a fresh run.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, the
// `setScreen` table, row `playing` from "any other": "Begins a fresh run
// exactly as `LIGHT THE LAMP` and `TRY AGAIN` do: the idle run with Taper at
// level `1` and cooldown `0` in the first weapon slot", with `menuIndex` `0`.
// `specs/ui.md`, "A fresh run", states the same run.
//
// THE POSES. Each of the four screens reached through the surface and the
// real ending ticks, the ended runs carrying kills and a tick so a run kept
// by mistake is told from a fresh one, then the pose, read at the call and
// compared structurally against the idle run with Taper.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  FRESH_WEAPONS,
  IDLE_RUN,
  captureStill,
  createHarness,
  endDawn,
  endFallen,
  isolate,
  poseScreen,
  type Harness,
  type Screen,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** Reach `screen` with a disturbed run behind it. */
async function reach(screen: Screen): Promise<void> {
  if (screen === "title" || screen === "howto") {
    h.reset();
    poseScreen(h, screen);
    return;
  }
  isolate(h);
  h.debug.setKills(9);
  h.debug.setPlayerPosition(50, 50);
  if (screen === "fallen") await endFallen(h);
  else await endDawn(h);
}

it("begins the idle run with Taper from title, howto, fallen, and dawn", async () => {
  for (const from of ["title", "howto", "fallen", "dawn"] as const) {
    await reach(from);
    assertEqual(h.snapshot().screen, from, `screen reached before the pose`);

    h.debug.setScreen("playing");
    const after = h.snapshot();
    if (from === "dawn") {
      await h.frameDraw();
      captureStill(h, "fresh");
    }

    assertEqual(
      after.screen,
      "playing",
      `screen after setScreen('playing') from ${from}`,
    );
    assertEqual(
      after.menuIndex,
      0,
      `menuIndex after setScreen('playing') from ${from}`,
    );
    assertDeepEqual(
      after.run,
      { ...IDLE_RUN, weapons: [...FRESH_WEAPONS] },
      `run after setScreen('playing') from ${from}`,
    );
  }
});
