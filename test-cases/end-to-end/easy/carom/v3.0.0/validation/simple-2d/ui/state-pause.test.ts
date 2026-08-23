// Carom — ui/state-pause: pausing a live match opens the pause menu, and that
// menu offers what the specification says it offers.
//
// The match is started from the title with real key events and played past the
// pre-serve hold into a live rally, so the menu is raised over a match in flight
// rather than over its countdown. The pause key is a real key event too, and
// `Escape` drives both `pause` and `back`, so the build has to resolve it as the
// pause here.
//
// The three entries are the case's copy from `src/constants.ts`. Matching is by
// substring, because a selected entry is commonly drawn with a marker beside it.

import { afterEach, beforeEach, expect, it } from "vitest";
import { PAUSE_ITEMS } from "../../src/constants";
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

afterEach(() => {
  h?.dispose();
});

it("opens a pause menu offering resume, restart, and quit", async () => {
  await startWithKeys(h, "versus");
  await h.advance(RALLY_TICKS);
  expect(h.snapshot().screen).toBe("playing");

  await h.tap("Escape");
  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "pause");

  expect(h.snapshot().screen).toBe("paused");
  for (const item of PAUSE_ITEMS) {
    expect(drewText(h.calls, item)).toBe(true);
  }
});
