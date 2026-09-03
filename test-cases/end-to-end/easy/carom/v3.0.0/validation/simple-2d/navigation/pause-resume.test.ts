// Carom — navigation/pause-resume: confirming RESUME resumes the match.
//
// One transition of the menu state machine specs/ui.md fixes. The match is
// opened into live play through the debug surface — the title menus are the
// navigation checks' own surface to grade, not this one's — then paused with a
// real press, so the pause menu and everything after it are the build's own.
// Every key is a real key event dispatched at the target the engine listens on,
// so the action is raised by the binding the case declares, and the result is
// read back off the game's own state. The still is the frame the press left.

import { afterEach, beforeEach, it } from "vitest";
import { PAUSE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
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

it("resumes the paused match from the first pause item", async () => {
  await startPlaying(h, "versus");
  await h.tap("Escape");
  assertEqual(h.snapshot().screen, "paused");
  assertEqual(menuIndex0(h), 0);
  assertEqual(PAUSE_ITEMS[0], "RESUME");

  await h.tap("Enter");
  captureStill(h, "resumed");

  assertEqual(h.snapshot().screen, "playing");
});
