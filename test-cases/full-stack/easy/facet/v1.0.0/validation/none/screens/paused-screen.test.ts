// Facet — screens/paused-screen: the pause action holds play and opens the
// pause menu, showing the copy specs/ui.md fixes for it.
//
// specs/ui.md makes `paused` a screen "reached from `playing` with the `pause`
// action", gives it PAUSED_TITLE_TEXT (`PAUSED`) and the two entries of
// PAUSED_ITEMS (`RESUME`, `QUIT`), and states that `menuIndex` is `0` on
// arriving. Those are the three halves this point decides: the screen the
// action reaches, the item highlighted when it gets there, and that the menu is
// actually drawn — a pause screen whose entries are not on screen leaves a
// player holding a board with no visible way to resume or leave.
//
// The key is real. specs/controls.md binds `pause` to `KeyP` and fixes that
// table for a build of every engine, so `tapAction` delivers it as one press
// the frame reads as an edge.
//
// The board is posed rather than dealt, so what is behind the menu is a known,
// resting position: specs/instrumentation.md has a posed board rest exactly as
// it was written until a swap is accepted on it, and the filler carries a spare
// legal swap so the round is not over before the pause key is pressed.
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

it("opens the pause menu on the pause key, first item highlighted, with its copy drawn", async () => {
  const playing = await poseBoardWithEscape(h, []);
  assertEqual(playing.screen, "playing", "the screen pause is pressed on");

  await h.tapAction("pause");

  const paused = await h.snapshot();
  assertEqual(paused.screen, "paused", "the screen the pause action reaches");
  assertEqual(paused.menuIndex, 0, "the highlighted item on arriving");

  // One frame, and everything it put on screen. The still is that same frame.
  const drawn = await h.frameText();
  await captureStill(h, "paused");

  requireCopy(drawn, PAUSED_TITLE_TEXT);
  // Both entries, each on its own: `showsText` can find a phrase spanning two
  // adjacent draws, so the menu is asked about one item at a time rather than
  // as a joined run that a single long draw would answer for.
  for (const item of PAUSED_ITEMS) requireCopy(drawn, item);
});
