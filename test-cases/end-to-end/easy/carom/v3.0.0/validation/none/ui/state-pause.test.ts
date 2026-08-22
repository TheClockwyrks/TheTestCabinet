// Carom — ui/state-pause: pausing a live match opens the pause menu, and that
// menu offers what the specification says it offers.
//
// The match is started from the title with real key events and played past the
// pre-serve hold into a live rally, so the menu is raised over a match in flight
// rather than over its countdown. The pause key is a real key event too, and
// `Escape` drives both `pause` and `back`, so the build has to resolve it as the
// pause here.
//
// The three entries are the case's copy, from the specification. Matching is by
// substring, because a selected entry is commonly drawn with a marker beside it.

import { afterEach, beforeEach, expect, it } from "vitest";
import { PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  drewText,
  startWithKeys,
  type Harness,
} from "../harness";

/** Past the 1.0 s pre-serve hold and into a live rally: 1.3 s at 120 Hz. */
const RALLY_TICKS = 156;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens a pause menu offering resume, restart, and quit", async () => {
  await startWithKeys(h, "versus");
  await h.advance(RALLY_TICKS);
  expect((await h.snapshot()).screen).toBe("playing");

  await h.tap("Escape");
  const calls = await h.frameCalls();
  await captureStill(h, "pause");

  expect((await h.snapshot()).screen).toBe("paused");
  for (const item of PAUSE_ITEMS) {
    expect(drewText(calls, item)).toBe(true);
  }
});
