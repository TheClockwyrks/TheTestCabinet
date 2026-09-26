// Facet — screens/paused-copy: the pause menu shows the copy specs/ui.md fixes
// for it.
//
// specs/ui.md gives `paused` PAUSED_TITLE_TEXT (`PAUSED`) and the two entries of
// PAUSED_ITEMS (`RESUME`, `QUIT`). This point is that they are actually drawn: a
// pause screen whose entries are not on screen leaves a player holding a board
// with no visible way to resume or leave.
//
// THE SCREEN IS POSED, NOT PRESSED INTO. That the `pause` action reaches this
// screen with its first item highlighted is `keyboard/pause-key`'s and
// `keyboard/pause-escape`'s point, one for each key specs/controls.md binds, and
// pressing a key on the way here would only add those points' failure modes to
// this one. specs/instrumentation.md's `setScreen` shows the screen and changes
// nothing else, and "the screen behaves from there exactly as it does when a
// player reaches it".
//
// The board is posed rather than dealt, so what is behind the menu is a known,
// resting position: specs/instrumentation.md has a posed board rest exactly as
// it was written until a swap is accepted on it.
//
// The copy is read off the frame's draw calls through the shared harness's
// `drewTextAnywhere`, which decides whether the copy is among the runs of text
// they spell however the build spent its draw calls on it.

import { afterEach, beforeEach, it } from "vitest";
import { drawnTextLines, drewTextAnywhere } from "../case-harness/text";
import { assertEqual, fail } from "../assert";
import { PAUSED_ITEMS, PAUSED_TITLE_TEXT } from "../constants";
import {
  captureStill,
  createHarness,
  poseBoardWithEscape,
  type DrawCall,
  type Harness,
} from "../harness";

let h: Harness;

/**
 * The frame put `wanted` on screen, or the failure names the copy the screen
 * owes beside every run of text the frame actually spelled.
 */
function requireCopy(frame: readonly DrawCall[], wanted: string): void {
  if (!drewTextAnywhere(frame, wanted)) {
    fail(
      `the pause screen to show ${JSON.stringify(wanted)}`,
      drawnTextLines(frame),
    );
  }
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the pause heading and every menu item", async () => {
  const playing = poseBoardWithEscape(h, []);
  assertEqual(playing.screen, "playing", "the screen the pause is posed from");

  h.debug.setScreen("paused");

  // The fixture: the frame read below is the pause menu's.
  assertEqual(h.snapshot().screen, "paused", "the screen the pose reaches");

  // One frame, and everything it put on screen. The still is that same frame.
  const frame = await h.frameCalls();
  captureStill(h, "paused");

  requireCopy(frame, PAUSED_TITLE_TEXT);
  // Both entries, each on its own: `drewTextAnywhere` can find a phrase spanning
  // two adjacent draws, so the menu is asked about one item at a time rather than
  // as a joined run that a single long draw would answer for.
  for (const item of PAUSED_ITEMS) requireCopy(frame, item);
});
