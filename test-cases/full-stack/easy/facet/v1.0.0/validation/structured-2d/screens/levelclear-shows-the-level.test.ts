// Facet — screens/levelclear-shows-the-level: the level-clear screen reports the
// level just finished.
//
// specs/ui.md: "The screen also shows the level just finished, `state.level`,
// and both of the figures that level was measured by." This point is the level
// itself; the two figures beside it are
// `screens/levelclear-shows-best-chain`'s and
// `screens/levelclear-shows-best-move`'s, because specs/ui.md names three
// readouts and a build can draw some of them.
//
// THE SCREEN IS POSED, NOT PLAYED INTO. That meeting the level target raises
// this screen is `levels/level-advances`'s point, and driving a chain to the
// target on the way here would only add that point's failure modes to this one.
// specs/instrumentation.md's `setScreen` shows the screen and changes nothing
// else, and "the screen behaves from there exactly as it does when a player
// reaches it". The finished board is posed under it, because specs/ui.md has it
// showing behind the menu.
//
// WHY 13, AND WHY THE OTHER FIGURES ARE POSED TO ZERO. specs/ui.md fixes each
// readout's label and the state field it shows and fixes no numeric format, and
// `drewTextAnywhere` spans the whole frame's text, so the figure under test
// has to be one no other readout on the screen could be built from. The score,
// the longest chain and the best move are posed to `0`, and `13` is two digits
// so the needle is not a lone digit any readout could answer for. Posing on the
// screen itself is what specs/instrumentation.md allows: `setScore`,
// `setBestChain` and `setBestMove` each change nothing but their own figure.
//
// The copy is read off the frame's draw calls through the shared harness's
// `drewTextAnywhere`, which decides whether a string is among the runs of text
// they spell across every shape specs/ui.md leaves open — one call per line,
// one per word, one per glyph, or a figure drawn beside its label in a single
// run.

import { afterEach, beforeEach, it } from "vitest";
import { drawnTextLines, drewTextAnywhere } from "../case-harness/text";
import { assertEqual, fail } from "../assert";
import { quietRowsWithEscape } from "../board";
import {
  captureStill,
  createHarness,
  loadBoard,
  type DrawCall,
  type Harness,
} from "../harness";

/** The level finished. Two digits, so the needle is not a lone digit. */
const FINISHED_LEVEL = 13;

let h: Harness;

/**
 * The frame put `wanted` on screen, or the failure names the copy the screen
 * owes beside every run of text the frame actually spelled.
 */
function requireCopy(frame: readonly DrawCall[], wanted: string): void {
  if (!drewTextAnywhere(frame, wanted)) {
    fail(
      `the level-clear screen to show ${JSON.stringify(wanted)}`,
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

it("draws the level just finished", async () => {
  h.debug.reset();
  loadBoard(h, quietRowsWithEscape([]));
  h.debug.setLevel(FINISHED_LEVEL);
  h.debug.setScore(0);
  h.debug.setBestChain(0);
  h.debug.setBestMove(0);
  h.debug.setLevelScore(0);
  h.debug.setScreen("levelclear");

  // The fixture: the frame read below is the level-clear screen's, carrying the
  // level the game itself holds and nothing else built from its digits.
  const cleared = h.snapshot();
  assertEqual(cleared.screen, "levelclear", "the screen the pose reaches");
  assertEqual(cleared.level, FINISHED_LEVEL, "the level being reported");
  assertEqual(cleared.score, 0, "the posed score");
  assertEqual(cleared.bestChain, 0, "the posed longest chain");
  assertEqual(cleared.bestMove, 0, "the posed best move");

  // One frame, and everything it put on screen. The still is that same frame.
  const frame = await h.frameCalls();
  captureStill(h, "levelclear");

  requireCopy(frame, String(FINISHED_LEVEL));
});
