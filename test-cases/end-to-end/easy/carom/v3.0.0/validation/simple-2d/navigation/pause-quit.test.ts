// Carom — navigation/pause-quit: confirming QUIT TO MENU returns to the title.
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

it("returns to the title from the third pause item", async () => {
  await startWithKeys(h, "versus");
  await h.advance(RALLY_TICKS);
  expect(h.snapshot().screen).toBe("playing");
  h.debug.setScore(3, 4);
  await h.advance(1);
  await h.tap("Escape");
  expect(h.snapshot().screen).toBe("paused");
  expect(PAUSE_ITEMS[2]).toBe("QUIT TO MENU");

  await h.tap("ArrowDown");
  await h.tap("ArrowDown");
  expect(menuIndex0(h)).toBe(2);
  await h.tap("Enter");
  captureStill(h, "title");

  expect(h.snapshot().screen).toBe("title");
  expect(menuIndex0(h)).toBe(0);
  expect(h.snapshot().score).toEqual({ p1: 0, p2: 0 });
});
