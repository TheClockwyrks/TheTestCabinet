// Carom — ui/state-pause: pausing a live match opens the pause menu, and that
// menu draws the items the specification fixes for it.
//
// The match is opened into live play through the debug surface — the title
// menus are the navigation checks' own surface to grade, not this one's — so a
// build with a broken title menu but a working pause fails only there. The
// pause itself is a real `Escape` key event: nothing here has taken a paddle or
// anything else from the player, so the key reaches the game exactly as a
// player's does, and `Escape` raises both `pause` and `back` on one frame, so
// the build has to resolve it as the pause here.
//
// The field is isolated to the one ball live play needs and no obstacles. What
// this point reads is the menu; the frozen field behind it is the build's, and
// an isolated one keeps anything on it from scoring a point and moving the
// screen out from under the reading.
//
// The frame that is READ is advanced with the call list cleared, after the pause
// has landed, so what is inspected is one whole render of the pause screen. The
// three entries are the case's own, PAUSE_ITEMS from `validation/constants.ts`,
// which states what specs/ui.md fixes. Matching is by substring, because a
// selected entry is commonly drawn with a marker beside it.

import { afterEach, beforeEach, it } from "vitest";
import { PAUSE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import { drewText } from "../case-harness/text";
import {
  captureStill,
  createHarness,
  openIsolatedPlay,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens a pause menu drawing every pause item", async () => {
  const live = await openIsolatedPlay(h, { mode: "versus" });
  assertEqual(live.hit, true);
  assertEqual(h.snapshot().screen, "playing");

  await h.tap("Escape");
  assertEqual(h.snapshot().screen, "paused");

  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "pause");

  assertEqual(h.snapshot().screen, "paused");
  for (const item of PAUSE_ITEMS) {
    assertEqual(drewText(h.calls, item), true);
  }
});
