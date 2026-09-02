// Wick — progression/start-at-level-1: a run starts at level 1 with no
// experience.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/progression.md`, "Slots": "A
// run starts with Taper at level `1` in the first weapon slot, every other slot
// empty, `level` `1`, and `xp` `0`." "Levels and experience": "`level` starts
// at `1` and `xp` is a real number that starts at `0`", and `xpToNext(1)` is
// `XP_BASE` (`5`). `specs/state.md`'s idle run gives `kills` `0` and
// `pendingLevelUps` `0`.
//
// THE POSE. The run the game itself begins, not a posed one: `reset` and
// `setScreen("playing")`, which `specs/instrumentation.md` makes the same run
// `LIGHT THE LAMP` begins. Nothing is cleared and no switch is touched, so
// what is read is the state a player would be handed. The reading is taken
// before any tick runs, so it is the run's opening values rather than what a
// first tick left.
//
// THE TOLERANCE. Exact: every figure here is a stated whole number.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { XP_BASE } from "../constants";
import {
  captureStill,
  createHarness,
  freshRun,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("opens a run at level 1 with xp 0, xpToNext 5, no kills, and nothing queued", async () => {
  const start = freshRun(h);
  await h.frameDraw();
  captureStill(h, "start");

  assertEqual(start.run.level, 1, "run.level at the start of a run");
  assertEqual(start.run.xp, 0, "run.xp at the start of a run");
  assertEqual(
    start.run.xpToNext,
    XP_BASE,
    "run.xpToNext at the start of a run (specs/progression.md)",
  );
  assertEqual(start.run.kills, 0, "run.kills at the start of a run");
  assertEqual(
    start.run.pendingLevelUps,
    0,
    "run.pendingLevelUps at the start of a run",
  );
});
