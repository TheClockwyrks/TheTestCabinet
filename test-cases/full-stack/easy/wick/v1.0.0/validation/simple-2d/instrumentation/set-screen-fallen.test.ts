// instrumentation/set-screen-fallen — `setScreen('fallen')` on playing or
// paused ends the run exactly as falling does: screen fallen with menuIndex 0
// and the run kept, its tick, level, and kills reported for the end screen.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setScreen`'s row
// for `fallen`, `dawn`: from "`playing`, `paused`", "Ends the run exactly as
// that ending does, the run kept for the end screen to report". specs/ui.md:
// `fallen` "shows the run's figures": time survived, level, kills; "The
// `fallen` and `dawn` screens keep the run that just ended" (specs/state.md).
//
// THE POSE. The busy night, with its posed level and kills and a few ticks on
// the clock, once from playing and once from paused. After each pose the
// screen and menu index are read and the run's figures compared against the
// reading before it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { BUSY, poseBusyNight } from "./helpers";

const RUN_TICKS = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("ends the run fallen from playing and from paused, the run kept", async () => {
  for (const from of ["playing", "paused"] as const) {
    poseBusyNight(h);
    const before = await h.tick(RUN_TICKS);
    if (from === "paused") h.debug.setScreen("paused");
    assertEqual(h.snapshot().screen, from, "the screen the pose is issued on");

    h.debug.setScreen("fallen");
    const s = h.snapshot();

    assertEqual(s.screen, "fallen", `the screen after setScreen from ${from}`);
    assertEqual(s.menuIndex, 0, `menuIndex on arriving from ${from}`);
    assertEqual(s.run.tick, before.run.tick, `run.tick kept from ${from}`);
    assertEqual(s.run.level, BUSY.level, `run.level kept from ${from}`);
    assertEqual(s.run.kills, BUSY.kills, `run.kills kept from ${from}`);
  }
  await h.tick(1);
  captureStill(h, "fallen");
});
