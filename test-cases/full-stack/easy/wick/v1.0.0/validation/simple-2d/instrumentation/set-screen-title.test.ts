// instrumentation/set-screen-title — `setScreen('title')` from playing stands
// the game on title with menuIndex 0.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setScreen`: "Sets
// `screen` to `name`, one of the `Screen` values, with `menuIndex`,
// `almanacTab`, and `almanacScroll` all `0`", and "Applies on every screen".
// What the pose leaves standing beside the screen is
// `set-screen-leaves-the-run-standing`; what this decides is that the named
// screen is the one the game stands on afterwards. Whether `MAIN MENU` on
// paused reaches the title is a screens point.
//
// THE POSE. The call is made from `playing`, a screen the game is not already
// on, so the `title` it reports is the call's. The night is isolated, so no
// tick runs between the pose and the reading and nothing else could have moved
// the screen.
//
// THE TOLERANCE. None: a screen name and a menu index.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("stands the game on title", async () => {
  const playing = isolate(h);
  assertEqual(playing.screen, "playing", "the screen the call is made from");

  h.debug.setScreen("title");
  const title = h.snapshot();
  await h.frameDraw();
  captureStill(h, "title");

  assertEqual(title.screen, "title", "the screen after setScreen('title')");
  assertEqual(title.menuIndex, 0, "menuIndex on entering title");
});
