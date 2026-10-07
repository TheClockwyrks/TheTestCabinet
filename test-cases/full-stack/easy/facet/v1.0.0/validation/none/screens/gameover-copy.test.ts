// Facet — screens/gameover-copy: the game-over screen shows the copy specs/ui.md
// fixes for it.
//
// specs/ui.md gives `gameover` its heading GAMEOVER_TITLE_TEXT (`NO MOVES LEFT`)
// and the two entries of GAMEOVER_ITEMS (`PLAY AGAIN`, `QUIT`). This point is
// that they are actually drawn: the screen has to say why the round stopped and
// what the player may do next, and a build that reaches the state without
// drawing it leaves a player looking at a dead board with no way to start again.
//
// THE SCREEN IS POSED, NOT PLAYED INTO. That a settled board with no legal swap
// raises this screen is `levels/gameover-no-legal-swap`'s point, and driving a
// round to its end on the way here would only add that point's failure modes to
// this one. specs/instrumentation.md's `setScreen` shows the screen and changes
// nothing else, and "the screen behaves from there exactly as it does when a
// player reaches it".
//
// THE FINISHED BOARD IS POSED UNDER IT, because specs/ui.md has it showing
// behind the menu, so the frame read here is the frame a player sees.
//
// THE TWO FIGURES THE SCREEN CARRIES ARE THEIR OWN POINTS.
// `screens/gameover-shows-the-score` and `screens/gameover-shows-the-level` read
// them, because a build can draw the heading and the menu and never report what
// the round was worth.
//
// The copy is read through `frameText`, which hands back a frame's draw calls
// and the page's own rendered DOM text, and `frameShows` decides whether a
// string is among what they show — the calls through the shared harness's
// `drewTextAnywhere` — across every shape specs/ui.md leaves open: one call per
// line, one per word, one per glyph, or a figure drawn beside its label in a
// single run.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { GAMEOVER_ITEMS, GAMEOVER_TITLE_TEXT } from "../constants";
import { deadBoard } from "../board";
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
      `the game-over screen to show ${JSON.stringify(wanted)}`,
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

it("draws the game-over heading and every menu item", async () => {
  await h.debug.reset();
  await loadBoard(h, deadBoard());
  await h.debug.setScreen("gameover");

  // The fixture: the frame read below is the game-over screen's.
  assertEqual(
    (await h.snapshot()).screen,
    "gameover",
    "the screen the pose reaches",
  );

  // One frame, and everything it put on screen. The still is that same frame.
  const frame = await h.frameText();
  await captureStill(h, "gameover");

  requireCopy(frame, GAMEOVER_TITLE_TEXT);
  // Both entries, each on its own: `frameShows` can find a phrase spanning two
  // adjacent draws, so the menu is asked about one item at a time rather than
  // as a joined run that a single long draw would answer for.
  for (const item of GAMEOVER_ITEMS) requireCopy(frame, item);
});
