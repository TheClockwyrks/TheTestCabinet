// Carom — ui/state-pause: pausing a live match opens the pause menu, and that
// menu draws the items the specification fixes for it.
//
// The match is opened through the debug surface and run up to live play
// (`startPlaying`), so the menu is raised over a match in flight rather than
// over its countdown, and a build with a broken title menu but a working pause
// fails only the navigation checks. The pause is a real `Escape` key event —
// the debug driver holds only the paddles, so the key still lands — and
// `Escape` drives both `pause` and `back`, so the build has to resolve it as
// the pause here.
//
// The three entries are the case's copy, PAUSE_ITEMS from `src/constants.ts`
// (specs/ui.md). Matching is by substring, because a selected entry is commonly
// drawn with a marker beside it.

import { afterEach, beforeEach, it } from "vitest";
import { PAUSE_ITEMS } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  drewText,
  startPlaying,
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
  await startPlaying(h, "versus");
  assertEqual(h.snapshot().screen, "playing");

  await h.tap("Escape");
  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "pause");

  assertEqual(h.snapshot().screen, "paused");
  for (const item of PAUSE_ITEMS) {
    assertEqual(drewText(h.calls, item), true);
  }
});
