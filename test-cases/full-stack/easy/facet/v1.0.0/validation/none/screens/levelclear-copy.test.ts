// Facet — screens/levelclear-copy: the level-clear screen shows the copy
// specs/ui.md fixes for it.
//
// specs/ui.md gives `levelclear` its heading LEVELCLEAR_TITLE_TEXT (`LEVEL
// CLEAR`) and the two entries of LEVELCLEAR_ITEMS (`CONTINUE`, `QUIT`). This
// point is that they are actually drawn: the screen has to say what was finished
// and what the player may do next, and a build that draws neither entry leaves a
// player with no visible route past the level they have just won.
//
// THE SCREEN IS POSED, NOT PLAYED INTO. That meeting the level target raises
// this screen is `levels/level-advances`'s point, and driving a chain to the
// target on the way here would only add that point's failure modes to this one.
// specs/instrumentation.md's `setScreen` shows the screen and changes nothing
// else, and "the screen behaves from there exactly as it does when a player
// reaches it".
//
// THE FINISHED BOARD IS POSED UNDER IT, because specs/ui.md has it showing
// behind the menu, so the frame read here is the frame a player sees.
//
// THE THREE FIGURES THE SCREEN CARRIES ARE THEIR OWN POINTS.
// `screens/levelclear-shows-the-level`, `screens/levelclear-shows-best-chain`
// and `screens/levelclear-shows-best-move` read them, because a build can draw
// the heading and the menu and never report what the level was measured by.
//
// The copy is read through `frameText`, which hands back a frame's draw calls
// and the page's own rendered DOM text, and `frameShows` decides whether a
// string is among what they show — the calls through the shared harness's
// `drewTextAnywhere` — across every shape specs/ui.md leaves open: one call per
// line, one per word, one per glyph, or a figure drawn beside its label in a
// single run.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { LEVELCLEAR_ITEMS, LEVELCLEAR_TITLE_TEXT } from "../constants";
import { quietRowsWithEscape } from "../board";
import {
  captureStill,
  createHarness,
  frameShows,
  loadBoard,
  shownText,
  type FrameText,
  type Harness,
} from "../harness";

let h: Harness;

/**
 * The frame put `wanted` on screen, or the failure names the copy the screen
 * owes beside every string the frame actually showed.
 */
function requireCopy(frame: FrameText, wanted: string): void {
  if (!frameShows(frame, wanted)) {
    fail(
      `the level-clear screen to show ${JSON.stringify(wanted)}`,
      shownText(frame),
    );
  }
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the level-clear heading and every menu item", async () => {
  await h.debug.reset();
  await loadBoard(h, quietRowsWithEscape([]));
  await h.debug.setScreen("levelclear");

  // The fixture: the frame read below is the level-clear screen's.
  assertEqual(
    (await h.snapshot()).screen,
    "levelclear",
    "the screen the pose reaches",
  );

  // One frame, and everything it put on screen. The still is that same frame.
  const frame = await h.frameText();
  await captureStill(h, "levelclear");

  requireCopy(frame, LEVELCLEAR_TITLE_TEXT);
  // Both entries, each on its own: `frameShows` can find a phrase spanning two
  // adjacent draws, so the menu is asked about one item at a time rather than
  // as a joined run that a single long draw would answer for.
  for (const item of LEVELCLEAR_ITEMS) requireCopy(frame, item);
});
