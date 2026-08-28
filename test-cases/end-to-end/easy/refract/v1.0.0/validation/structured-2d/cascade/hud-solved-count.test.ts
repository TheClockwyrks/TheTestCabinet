// Refract — cascade/hud-solved-count: the boards-solved count is on screen
// while playing.
//
// specs/modes/cascade.md "The count": during playing, show the count beside
// the label HUD_SOLVED_LABEL (SOLVED), clear of the board, whose extent
// specs/board.md gives. One real solve puts the count at 1, NEXT BOARD
// returns to playing, and the frame's text draws are read back: a run
// carrying the label, a run reading 1 beside it — within one CELL_PITCH,
// the spec's own unit of adjacent placement, or in the label's own run — and
// both clear of the current board's extent widened by NODE_R. Where the
// readout sits and how it is styled is the build's; only "beside" and "clear
// of the board" are measured.

import { afterEach, beforeEach, it } from "vitest";
import { HUD_SOLVED_LABEL } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  drawnTextSpans,
  solveGenerated,
  tapAction,
  type Harness,
} from "../harness";
import { assertLabeledDigitClear, boardKeepOut } from "./helpers";

const SEED = 1;
/** One solve: the count the label carries is the digit 1. */
const SOLVES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws SOLVED with the digit 1 beside it, clear of the board", async () => {
  await solveGenerated(h, SOLVES, SEED);
  await tapAction(h, "confirm");
  const snapshot = h.snapshot();
  assertEqual(snapshot.screen, "playing", "back on playing after the solve");
  assertEqual(snapshot.solvedCount, SOLVES, "the one solve is counted");

  h.calls.length = 0;
  await h.advance(1);
  // The count drawn beside its label.
  captureStill(h, "hud");

  assertLabeledDigitClear(
    drawnTextSpans(h),
    HUD_SOLVED_LABEL,
    SOLVES,
    boardKeepOut(snapshot.board),
  );
});
