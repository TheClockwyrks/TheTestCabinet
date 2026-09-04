// Facet — keyboard/pause-escape: `Escape`, pressed on a live board, raises the
// pause menu.
//
// specs/controls.md binds `pause` to two keys, `Escape` and `KeyP`, and says
// "Each key listed for an action fires that action on its own, so either key of a
// two-key action is enough." `keyboard/pause-key` presses the second; this point
// presses the first, and the two are separate because a build can bind one and
// miss the other. The effect is the one that file reads: specs/controls.md's
// table says `pause` "Enters and leaves `paused` from `playing`", and specs/ui.md
// says `paused` is "reached from `playing` with the `pause` action" with
// "`menuIndex` … `0` on arriving."
//
// WHY THIS KEY IS THE INTERESTING ONE. `Escape` is listed twice in that table:
// under `pause` and under `back`. The specification keeps the two apart by
// screen — "`pause` acts on `playing` and `paused` and nowhere else, `back` on
// `howto` and `gameover` and nowhere else" — so a frame that fires both is
// unambiguous on any screen, and on `playing` the only one of the pair with
// anything to do is `pause`. A build that routed the key to `back` alone, or
// that let `back` swallow it before `pause` could act, leaves the board unpaused
// and fails exactly here. What the same key does on a screen `back` acts on is
// `keyboard/back-key`'s point.
//
// THE KEY IS REAL, NOT POSED. `setScreen("paused")` arranges the same screen,
// and driving that would prove the screen exists while saying nothing about the
// binding — which is the whole point. The key is pressed through the real input
// path instead, and the frame that press runs is what the screen is read
// after.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { quietRowsWithEscape } from "../board";
import { BINDINGS } from "../constants";
import {
  captureStill,
  createHarness,
  loadBoard,
  type Harness,
} from "../harness";

let h: Harness;

/**
 * `Escape`, the first of the two keys specs/controls.md binds `pause` to.
 *
 * Read out of the table rather than written down, so the key this check presses
 * is the key the case states. `keyboard/pause-key` presses the second.
 */
const PAUSE_KEY = BINDINGS.pause[0];

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it(`opens the pause menu when ${PAUSE_KEY} is pressed on a live board`, async () => {
  // A posed board puts the game on `playing` with a settled position, which is
  // the screen the effect table says `pause` is entered FROM. The filler carries
  // a spare legal swap, so the round cannot end out from under the check.
  loadBoard(h, quietRowsWithEscape([]));

  const before = h.snapshot();
  assertEqual(before.screen, "playing", "the screen the key is pressed on");

  // A real press of the bound key, delivered as an edge one frame reads.
  await h.tap(PAUSE_KEY);

  // The frame the press ran is the first frame of the pause menu, so the
  // picture kept here is the screen the key opened.
  captureStill(h, "paused");

  const after = h.snapshot();
  assertEqual(after.screen, "paused", `the screen after ${PAUSE_KEY}`);
  assertEqual(after.menuIndex, 0, "the highlighted item on arriving at paused");
});
