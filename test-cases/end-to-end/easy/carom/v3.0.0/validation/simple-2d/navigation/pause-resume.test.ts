// Carom — navigation/pause-resume: confirming RESUME resumes the match.
//
// One transition of the menu state machine specs/ui.md fixes. The match is
// started from the title with menu keys and played into a live rally, then
// paused with a real press, so the pause menu is reached the way a player
// reaches it. Every key is a real key event dispatched at the target the engine
// listens on, so the action is raised by the binding the case declares, and the
// result is read back off the game's own state. The still is the frame the
// press left.

import { afterEach, beforeEach, expect, it } from "vitest";
import { PAUSE_ITEMS } from "../../src/constants";
import {
  captureStill,
  createHarness,
  menuIndex0,
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

it("resumes the paused match from the first pause item", async () => {
  await startWithKeys(h, "versus");
  await h.advance(RALLY_TICKS);
  expect(h.snapshot().screen).toBe("playing");
  await h.tap("Escape");
  expect(h.snapshot().screen).toBe("paused");
  expect(menuIndex0(h)).toBe(0);
  expect(PAUSE_ITEMS[0]).toBe("RESUME");

  await h.tap("Enter");
  captureStill(h, "resumed");

  expect(h.snapshot().screen).toBe("playing");
});
