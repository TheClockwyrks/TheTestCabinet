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
// The copy is read through `frameText`, which gathers a frame's canvas text and
// the page's own DOM text alike, because specs/assets.md has an engineless
// build draw its chrome "in code (canvas or DOM)" and this point is not about
// which of the two it chose.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { PAUSED_ITEMS, PAUSED_TITLE_TEXT } from "../constants";
import {
  captureStill,
  createHarness,
  poseBoardWithEscape,
  showsText,
  type Harness,
} from "../harness";

let h: Harness;

/**
 * The frame put `wanted` on screen, or the failure names the copy the screen
 * owes beside every string the frame actually drew.
 */
function requireCopy(drawn: readonly string[], wanted: string): void {
  if (!showsText(drawn, wanted)) {
    fail(`the pause screen to show ${JSON.stringify(wanted)}`, drawn);
  }
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the pause heading and every menu item", async () => {
  const playing = await poseBoardWithEscape(h, []);
  assertEqual(playing.screen, "playing", "the screen the pause is posed from");

  await h.debug.setScreen("paused");

  // The fixture: the frame read below is the pause menu's.
  assertEqual(
    (await h.snapshot()).screen,
    "paused",
    "the screen the pose reaches",
  );

  // One frame, and everything it put on screen. The still is that same frame.
  const drawn = await h.frameText();
  await captureStill(h, "paused");

  requireCopy(drawn, PAUSED_TITLE_TEXT);
  // Both entries, each on its own: `showsText` can find a phrase spanning two
  // adjacent draws, so the menu is asked about one item at a time rather than
  // as a joined run that a single long draw would answer for.
  for (const item of PAUSED_ITEMS) requireCopy(drawn, item);
});
