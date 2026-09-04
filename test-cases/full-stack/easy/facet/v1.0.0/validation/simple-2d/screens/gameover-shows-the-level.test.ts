// Facet — screens/gameover-shows-the-level: the game-over screen reports the level the round reached.
//
// specs/ui.md: "The screen also shows the round's final `state.score` and the
// `state.level` it reached." This point is the `state.level` it reached. A build that
// reaches the screen and reports nothing has ended the round and told the player
// nothing about it.
//
// THE OTHER FIGURE IS ITS OWN POINT. specs/ui.md names two, and a build can draw
// one of them: they are two fields and two chances to forget one.
//
// THE SCREEN IS POSED, NOT PLAYED INTO. That a settled board with no legal swap
// raises this screen is `levels/gameover-no-legal-swap`'s point, and driving a
// round to its end on the way here would only add that point's failure modes to
// this one. specs/instrumentation.md's `setScreen` shows the screen and changes
// nothing else, and "the screen behaves from there exactly as it does when a
// player reaches it". The finished board is posed under it, because specs/ui.md
// has it showing behind the menu.
//
// THE TWO FIGURES ARE POSED, so what the screen owes is known rather than
// computed. `setScore` and `setLevel` are the poses specs/instrumentation.md
// gives for exactly that, and both are read back off the snapshot before the
// frame is drawn, so the string looked for is the figure the game itself holds.
// FINAL_SCORE is under a thousand and FINAL_LEVEL is two digits: the first
// because specs/ fixes no grouping for a large number and a build is free to
// write one, the second so the needle is not a lone digit that any readout could
// answer for. The two share no digit, so neither can answer for the other on a
// frame `showsText` searches whole.
//
// The copy is read through `frameText`, which hands back every string one frame
// put on screen, and `showsText` decides whether a string is among them across
// every shape specs/ui.md leaves open — one call per line, one per word, one per
// glyph, or a figure drawn beside its label in a single run.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { deadBoard } from "../board";
import {
  captureStill,
  createHarness,
  loadBoard,
  showsText,
  type Harness,
} from "../harness";

/** The score the round ends on. Under a thousand, so no grouping is at issue. */
const FINAL_SCORE = 730;

/** The level the round ends on. Two digits, so the needle is not a lone digit. */
const FINAL_LEVEL = 12;

let h: Harness;

/**
 * The frame put `wanted` on screen, or the failure names the copy the screen
 * owes beside every string the frame actually drew.
 */
function requireCopy(drawn: readonly string[], wanted: string): void {
  if (!showsText(drawn, wanted)) {
    fail(`the game-over screen to show ${JSON.stringify(wanted)}`, drawn);
  }
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the level the round reached", async () => {
  h.debug.reset();
  loadBoard(h, deadBoard());
  h.debug.setScore(FINAL_SCORE);
  h.debug.setLevel(FINAL_LEVEL);
  h.debug.setLevelScore(0);
  h.debug.setScreen("gameover");

  // The fixture: the frame read below is the game-over screen's, and it carries
  // the figures the game itself holds.
  const over = h.snapshot();
  assertEqual(over.screen, "gameover", "the screen the pose reaches");
  assertEqual(over.score, FINAL_SCORE, "the score the round ended on");
  assertEqual(over.level, FINAL_LEVEL, "the level the round ended on");

  // One frame, and everything it put on screen. The still is that same frame.
  const drawn = await h.frameText();
  captureStill(h, "gameover");

  requireCopy(drawn, String(FINAL_LEVEL));
});
