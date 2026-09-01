// Wick — instrumentation/set-screen-howto: `setScreen('howto')` from `title`
// enters `howto` with `menuIndex` 0 and the idle run.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, the
// `setScreen` table, row `howto` from any: "Enters the how-to screen exactly
// as confirming `HOW TO PLAY` does: the idle run", with `menuIndex` `0`.
// `specs/state.md`, "The idle run", is `IDLE_RUN`.
//
// THE POSE. `reset` to the title, the highlight moved off 0 by a real press
// so `menuIndex` 0 is read as the pose's doing, then the pose, read at the
// call.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  IDLE_RUN,
  captureStill,
  createHarness,
  tap,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("enters howto with menuIndex 0 and the idle run", async () => {
  h.reset();
  const moved = await tap(h, "ArrowDown");
  assertEqual(moved.menuIndex, 1, "menuIndex moved off 0 before the pose");

  h.debug.setScreen("howto");
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "howto");

  assertEqual(after.screen, "howto", "screen after setScreen('howto')");
  assertEqual(after.menuIndex, 0, "menuIndex after setScreen('howto')");
  assertDeepEqual(after.run, IDLE_RUN, "run after setScreen('howto')");
});
