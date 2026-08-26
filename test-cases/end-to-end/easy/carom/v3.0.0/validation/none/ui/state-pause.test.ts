// Carom — ui/state-pause: pausing a live match opens the pause menu, and that
// menu offers what the specification says it offers.
//
// The match is opened through the debug surface and run up to live play
// (`startPlaying`), so the menu is raised over a match in flight rather than
// over its countdown, and a build with a broken title menu but a working pause
// fails only the navigation checks. The pause is a real `Escape` key event —
// the debug driver holds only the paddles, so the key still lands — and
// `Escape` drives both `pause` and `back`, so the build has to resolve it as
// the pause here.
//
// The three entries are the case's copy, from the specification. Matching is by
// substring, because a selected entry is commonly drawn with a marker beside it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PAUSE_ITEMS } from "../constants";
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

afterEach(async () => {
  await h.dispose();
});

it("opens a pause menu offering resume, restart, and quit", async () => {
  await startPlaying(h, "versus");
  assertEqual((await h.snapshot()).screen, "playing");

  await h.tap("Escape");
  const calls = await h.frameCalls();
  await captureStill(h, "pause");

  assertEqual((await h.snapshot()).screen, "paused");
  for (const item of PAUSE_ITEMS) {
    assertEqual(drewText(calls, item), true);
  }
});
