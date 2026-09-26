// states/opens-on-title — a freshly loaded game is on the title, on its first
// menu item.
//
// specs/ui.md: "the game opens on `title`", and "arriving at `title` sets
// [`menuIndex`] to `titleIndex`" — which specs/ui.md's "The remembered title
// selection" has "opening at `0`". Both are read off the game as it stands the
// moment it has initialized, before a key is pressed and before anything is
// posed.
//
// WHAT MAKES THIS A READING OF THE LOAD. The harness builds the engine, subscribes
// to it, and calls `engine.initialize()` — which is the build's own `initialize`,
// the same call the page makes — and then hands the harness over WITHOUT
// resetting. So the first snapshot a check takes is the state the load left, and
// nothing here has to reopen the build in a second page to get at it. Reading it
// after a reset would decide the reset rather than the load, because
// specs/instrumentation.md has a reset restore the title screen and a `menuIndex`
// of `0` whatever the build did at load, and a build that opened on its own
// how-to screen would pass.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("loads onto the title screen with the first item highlighted", async () => {
  const loaded = h.snapshot();

  // The one frame the still is taken off, run after the reading rather than
  // before it, so what is asserted is the state the load itself left.
  await h.advance(1);
  captureStill(h, "title");

  assertEqual(loaded.screen, "title", "the screen a freshly loaded game is on");
  assertEqual(loaded.menuIndex, 0, "the highlighted item of the title menu");
});
