// Refract — cascade/hud-solved-count: the boards-solved count is on screen
// while playing.
//
// specs/modes/cascade.md "The count": during `playing`, show the count beside
// the label HUD_SOLVED_LABEL (SOLVED), clear of the board, whose extent
// specs/board.md gives. TWO generated boards are really solved — the
// spec-derived solver's beams drawn through `trace` — and NEXT BOARD taken,
// so the count while playing is 2; the next playing frame's text runs are
// read back, and one of them must be the label with the figure 2 beside it,
// the pair clear of the board's extent. The adjacency and glyph-band figures
// are stated in cascade/hud.ts.
//
// WHY TWO SOLVES AND NOT ONE. After one solve the count and the tier both
// read 1, so a build that drew only "TIER 1" beside a bare SOLVED label would
// satisfy this point without ever showing the count. Two solves separate the
// two figures — the tier is still 1 after two solves (specs/modes/cascade.md's
// ladder) — so the 2 this reads can only be the boards-solved count.
//
// The frame's text is read as COALESCED RUNS rather than as raw `fillText`
// calls, because a build is free to letter-space its HUD and canvas has no
// portable property for it, so tracked copy is drawn a glyph at a time.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HUD_SOLVED_LABEL } from "../constants";
import {
  captureStill,
  createHarness,
  drawnTextRuns,
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

it("draws SOLVED with the figure 2 beside it, clear of the board, after two solves", async () => {
  await resetTo(h, 1);
  await startCascade(h);
  await solveGenerated(h, 2);
  await tapAction(h, "confirm"); // NEXT BOARD (specs/modes/cascade.md)
  assertEqual(h.snapshot().screen, "playing", "back in playing after NEXT");
  assertEqual(h.snapshot().solvedCount, 2, "two boards are recorded solved");

  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "hud");

  const found = findLabelWithFigure(
    drawnTextRuns(h),
    HUD_SOLVED_LABEL,
    2,
    `a playing frame drawing HUD_SOLVED_LABEL (${HUD_SOLVED_LABEL}) with ` +
      "the figure 2 adjacent (specs/modes/cascade.md: the count is shown " +
      "beside the label)",
  );
  assertClearOfBoard(h, found.label, `the ${HUD_SOLVED_LABEL} label`);
  assertClearOfBoard(h, found.figure, "the boards-solved count");
});
