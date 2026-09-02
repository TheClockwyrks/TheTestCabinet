// Wick — instrumentation/set-screen-playing-closes-chest: `setScreen('playing')`
// on `chest` returns to `playing` with `chestResult` null and the run
// otherwise untouched.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, the
// `setScreen` table, row `playing` from `chest`: "Closes the overlay exactly
// as `confirm` does: `chestResult` becomes `null`", with `menuIndex` `0`.
// `specs/progression.md`, "The chest overlay": "`confirm` closes it, setting
// `chestResult` to `null` and `screen` to `playing`".
//
// THE POSE. An isolated run with a moth and a gem on the field, the chest
// overlay opened by the real collection tick (`openChest`), then the pose.
// The run after is the run before with `chestResult` replaced by `null`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  openChest,
  placeEnemy,
  placeGem,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("closes the chest overlay and leaves the run otherwise as it was", async () => {
  isolate(h);
  placeEnemy(h, "moth", 300, 0);
  placeGem(h, "medium", 400, 100);
  const open = await openChest(h);
  assertEqual(open.screen, "chest", "screen before the pose");
  assertNotNull(open.run.chestResult, "chestResult on the open overlay");

  h.debug.setScreen("playing");
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "closed");

  assertEqual(after.screen, "playing", "screen after setScreen('playing')");
  assertEqual(after.menuIndex, 0, "menuIndex after setScreen('playing')");
  assertDeepEqual(
    after.run,
    { ...open.run, chestResult: null },
    "run after closing, against the run under the overlay",
  );
});
