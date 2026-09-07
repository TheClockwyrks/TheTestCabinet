// Refract — pointer/pointer-takes-a-solved-choice: a press and release takes a
// choice on the solved screen.
//
// specs/modes/campaign.md gives each choice on `solved` its own `menu-<i>`
// target, counted from `0` in the order the screen offers them, and
// specs/controls.md says taking one does what `confirm` with the highlight there
// does. The first choice on a course board that is not the last is the next
// board, so taking `menu-0` puts a board in play.

import { afterEach, beforeEach, it } from "vitest";
import { MINIMAL_2X1 } from "../fixtures";
import { cellCenterOf } from "../pointer-helpers";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  loadBoard,
  pressRelease,
  resetTo,
  targetById,
  targetCenter,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes the first choice from a press and release on its target", async () => {
  await resetTo(h);
  const board = await loadBoard(h, MINIMAL_2X1);

  // One segment joins the two emitters and solves the board, which is what
  // moves the game to the solved screen (specs/modes/campaign.md).
  const left = cellCenterOf(board, { col: 0, row: 0 });
  const right = cellCenterOf(board, { col: 1, row: 0 });
  h.debug.pointerDown(left.x, left.y);
  h.debug.pointerMove(right.x, right.y);
  h.debug.pointerUp();
  await h.advance(1);

  assertEqual(h.snapshot().screen, "solved", "the board is solved first");
  assertEqual(h.snapshot().menuIndex, 0, "with the first choice highlighted");

  const first = targetCenter(targetById(h.snapshot(), "menu-0"));
  await pressRelease(h, first);

  assertEqual(
    h.snapshot().screen,
    "playing",
    "taking menu-0 enters the next board, as confirm at menuIndex 0 does " +
      "(specs/controls.md, Operating a screen with the pointer)",
  );
  captureStill(h, "next");
});
