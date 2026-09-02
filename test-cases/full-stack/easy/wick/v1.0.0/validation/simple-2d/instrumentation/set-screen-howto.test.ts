// instrumentation/set-screen-howto — `setScreen('howto')` from title enters
// howto with menuIndex 0 and the idle run, exactly as confirming HOW TO PLAY
// does.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setScreen`'s row
// for `howto`: from "any", "Enters the how-to screen exactly as confirming
// `HOW TO PLAY` does: the idle run", "with `menuIndex` `0`". specs/ui.md:
// `HOW TO PLAY` "Sets `screen = howto` and `menuIndex = 0`".
//
// THE POSE. A fresh reset, the highlight moved to the second item by a real
// key so `menuIndex` is not already 0, then the pose. The route to howto is
// the surface alone; whether the menu's confirm reaches it is a screens point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, tap, type Harness } from "../harness";
import { assertIdleRun } from "./helpers";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("enters the how-to screen with the idle run", async () => {
  h.reset();
  const moved = await tap(h, "ArrowDown");
  assertEqual(moved.menuIndex, 1, "menuIndex moved before the pose");

  h.debug.setScreen("howto");
  const s = h.snapshot();
  await h.tick(1);
  captureStill(h, "howto");

  assertEqual(s.screen, "howto", "the screen");
  assertEqual(s.menuIndex, 0, "menuIndex on arriving");
  assertIdleRun(s.run, "run on howto: the idle run");
});
