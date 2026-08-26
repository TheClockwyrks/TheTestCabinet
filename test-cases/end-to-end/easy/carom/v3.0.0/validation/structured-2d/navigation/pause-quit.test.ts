// Carom — navigation/pause-quit: confirming QUIT TO MENU returns to the title.
//
// One transition of the menu state machine specs/ui.md fixes. The match is
// opened into live play through the debug surface — the title menus are the
// navigation checks' own surface to grade, not this one's — then paused with a
// real press, so the pause menu and everything after it are the build's own.
// Every key is a real key event dispatched at the target the engine listens on,
// so the action is raised by the binding the case declares, and the result is
// read back off the game's own state. The still is the frame the press left.

import { afterEach, beforeEach, it } from "vitest";
import { PAUSE_ITEMS } from "../../src/constants";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  menuIndex0,
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

it("returns to the title from the third pause item", async () => {
  await startPlaying(h, "versus");
  h.debug.setScore(3, 4);
  await h.advance(1);
  await h.tap("Escape");
  assertEqual(h.snapshot().screen, "paused");
  assertEqual(PAUSE_ITEMS[2], "QUIT TO MENU");

  await h.tap("ArrowDown");
  await h.tap("ArrowDown");
  assertEqual(menuIndex0(h), 2);
  await h.tap("Enter");
  captureStill(h, "title");

  assertEqual(h.snapshot().screen, "title");
  assertEqual(menuIndex0(h), 0);
  assertDeepEqual(h.snapshot().score, { p1: 0, p2: 0 });
});
