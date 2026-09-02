// progression/start-at-level-1 — a run starts at level 1 with no experience.
//
// WHERE THE THRESHOLD COMES FROM. specs/progression.md ("Slots"): "A run starts
// with Taper at level `1` in the first weapon slot, every other slot empty,
// `level` `1`, and `xp` `0`." The threshold it leaves at is `xpToNext(1)`,
// `XP_BASE` (`5`), by the formula under "Levels and experience".
// specs/state.md's idle run gives the other two readings: "no kills" and "no
// level-ups earned", so `kills` and `pendingLevelUps` are `0`.
//
// WHY THE WORLD IS POSED AS IT IS. Nothing is posed at all: a `reset` and the
// transition into `playing`, which "Begins a fresh run exactly as `LIGHT THE
// LAMP` and `TRY AGAIN` do" (specs/instrumentation.md). The reading is taken
// before any tick runs, so what it reports is the start of a run and not the
// state a tick left. The title menu is not pressed, because a build with a
// broken menu and a correct run start fails the menu points and passes this
// one.
//
// THE TOLERANCE. `level`, `xpToNext`, `kills`, and `pendingLevelUps` are whole
// numbers, read exactly; `xp` is "a real number", so it is read within
// `FLOAT_TOL`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { FLOAT_TOL, xpToNext } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens on level 1 with no experience, no kills, and nothing queued", async () => {
  const started = await startRun(h);
  await captureStill(h, "start");

  assertEqual(started.screen, "playing", "the screen a fresh run stands on");
  assertEqual(started.run.level, 1, "the level a run starts at");
  assertNear(started.run.xp, 0, FLOAT_TOL, "the experience a run starts with");
  assertEqual(
    started.run.xpToNext,
    xpToNext(1),
    "the experience needed to leave the first level",
  );
  assertEqual(started.run.kills, 0, "the kills a run starts with");
  assertEqual(
    started.run.pendingLevelUps,
    0,
    "the level-ups queued at the start of a run",
  );
});
