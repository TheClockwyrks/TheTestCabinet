// Facet — screens/paused-back: both of the keys that leave the pause menu leave
// it.
//
// specs/ui.md gives `paused` one sentence covering two actions: "`pause` and
// `back` both return to `playing` with the board exactly as it was left." So the
// key that opened the menu closes it again, and the key that leaves `howto` and
// `gameover` leaves this screen too — a player who hits Escape out of habit, or
// hits the pause key a second time, is back on the board either way rather than
// stuck behind a menu.
//
// BOTH KEYS ARE REAL, AND EACH IS PRESSED ON ITS OWN. specs/controls.md binds
// `back` to `Escape` and `pause` to `KeyP` and fixes that table for a build of
// every engine, so `tapAction` delivers each as one press a frame reads as an
// edge. The two are asserted separately, because a build that wired only one of
// them conforms to half a sentence and this point is the whole of it.
//
// THE MENU IS OPENED BY THE POSE, NOT BY THE KEY. specs/instrumentation.md
// defines `pause()` as the `pause` action from `playing`, so it arranges the
// screen this point starts on. Arranging it that way keeps the verdict about
// LEAVING the menu: a build whose pause key never opened the menu fails the
// point that is about opening it, and is still asked this question fairly.
//
// The board is posed and left at rest — `phase` is `idle`, so nothing on it is
// due to move — and it is read back in the notation of specs/board.md after each
// return, which is what "exactly as it was left" is measured as.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { assertBoardEquals } from "../board";
import {
  captureStill,
  createHarness,
  poseBoardWithEscape,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to playing with the board as it was left, on back and on pause alike", async () => {
  const playing = poseBoardWithEscape(h, []);
  assertEqual(playing.screen, "playing", "the screen the round is paused from");
  assertEqual(playing.phase, "idle", "the phase the posed board rests in");
  const heldBoard = h.board();

  // Escape, the `back` action.
  h.debug.pause();
  assertEqual(h.snapshot().screen, "paused", "the screen back is pressed on");
  await h.tapAction("back");

  const afterBack = h.snapshot();
  captureStill(h, "resumed");
  assertEqual(afterBack.screen, "playing", "the screen back returns to");
  assertBoardEquals(h.board(), heldBoard, "the board back returned to");

  // And the pause key again, from the same arrangement.
  h.debug.pause();
  assertEqual(h.snapshot().screen, "paused", "the screen pause is pressed on");
  await h.tapAction("pause");

  const afterPause = h.snapshot();
  assertEqual(afterPause.screen, "playing", "the screen pause returns to");
  assertBoardEquals(h.board(), heldBoard, "the board pause returned to");
});
