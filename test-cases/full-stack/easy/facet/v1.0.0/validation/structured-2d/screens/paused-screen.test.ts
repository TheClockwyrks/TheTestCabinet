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
// THE KEY IS REAL, AND IT IS `KeyP`. specs/controls.md binds `pause` to
// `Escape` and `KeyP` and fixes that table for a build of every engine, so
// either key opens the menu on its own; `KeyP` is the one pressed here because
// `Escape` also fires `back`, and a check that reached this screen through the
// key both actions share would leave which of the two acted open. `h.tap`
// delivers it as one press the frame reads as an edge, and the fixture asserts
// the key really is among the ones specs/controls.md binds to the action rather
// than trusting the letter written above.
//
// The board is posed rather than dealt, so what is behind the menu is a known,
// resting position: specs/instrumentation.md has a posed board rest exactly as
// it was written until a swap is accepted on it, and the filler carries a spare
// legal swap so the round is not over before the pause key is pressed.
//
// The copy is read through `frameText`, which hands back every string one frame
// put on screen, and `showsText` decides whether the copy is among them however
// the build spent its draw calls on it.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual, fail } from "../assert";
import { BINDINGS, PAUSED_ITEMS, PAUSED_TITLE_TEXT } from "../constants";
import {
  captureStill,
  createHarness,
  poseBoardWithEscape,
  showsText,
  type Harness,
} from "../harness";

/** The key of `pause` this point presses; the other is `Escape`. */
const PAUSE_KEY = "KeyP";

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

afterEach(() => {
  h?.dispose();
});

it("opens the pause menu on the pause key, first item highlighted, with its copy drawn", async () => {
  assertContains(
    BINDINGS.pause,
    PAUSE_KEY,
    "the keys specs/controls.md binds to the pause action",
  );

  const playing = poseBoardWithEscape(h, []);
  assertEqual(playing.screen, "playing", "the screen pause is pressed on");

  await h.tap(PAUSE_KEY);

  const paused = h.snapshot();
  assertEqual(paused.screen, "paused", "the screen the pause action reaches");
  assertEqual(paused.menuIndex, 0, "the highlighted item on arriving");

  // One frame, and everything it put on screen. The still is that same frame.
  const drawn = await h.frameText();
  captureStill(h, "paused");

  requireCopy(drawn, PAUSED_TITLE_TEXT);
  // Both entries, each on its own: `showsText` can find a phrase spanning two
  // adjacent draws, so the menu is asked about one item at a time rather than
  // as a joined run that a single long draw would answer for.
  for (const item of PAUSED_ITEMS) requireCopy(drawn, item);
});
