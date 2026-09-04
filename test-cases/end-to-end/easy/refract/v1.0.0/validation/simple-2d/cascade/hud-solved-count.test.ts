// Refract — cascade/hud-solved-count: the boards-solved count is on screen
// while playing.
//
// specs/modes/cascade.md "The count": during `playing`, show the count beside
// the label HUD_SOLVED_LABEL (SOLVED), clear of the board, whose extent
// specs/board.md gives. One generated board is really solved — the
// spec-derived solver's beams drawn through `trace` — and NEXT BOARD taken,
// so the count while playing is 1; the next playing frame's text runs are
// read back, and one of them must be the label with the digit 1 beside it,
// the pair clear of the board's extent. The adjacency and glyph-band figures
// are stated in cascade/hud.ts.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HUD_SOLVED_LABEL } from "../constants";
import {
  captureStill,
  createHarness,
  drawnTextSpans,
  resetTo,
  solveGenerated,
  startCascade,
  tapAction,
  type Harness,
} from "../harness";
import { assertClearOfBoard, findLabelWithFigure } from "./hud";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws SOLVED with the digit 1 beside it, clear of the board, after one solve", async () => {
  await resetTo(h, 1);
  await startCascade(h);
  await solveGenerated(h, 1);
  await tapAction(h, "confirm"); // NEXT BOARD (specs/modes/cascade.md)
  assertEqual(h.snapshot().screen, "playing", "back in playing after NEXT");
  assertEqual(h.snapshot().solvedCount, 1, "one board is recorded solved");

  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "hud");

  const found = findLabelWithFigure(
    drawnTextSpans(h),
    HUD_SOLVED_LABEL,
    1,
    `a playing frame drawing HUD_SOLVED_LABEL (${HUD_SOLVED_LABEL}) with ` +
      "the digit 1 adjacent (specs/modes/cascade.md: the count is shown " +
      "beside the label)",
  );
  assertClearOfBoard(h, found.label, `the ${HUD_SOLVED_LABEL} label`);
  assertClearOfBoard(h, found.figure, "the boards-solved count");
});
