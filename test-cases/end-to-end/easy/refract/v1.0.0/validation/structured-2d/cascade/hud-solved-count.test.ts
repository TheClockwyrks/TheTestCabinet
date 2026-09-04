// Refract — cascade/hud-solved-count: the boards-solved count is on screen
// while playing.
//
// specs/modes/cascade.md "The count": during playing, show the count beside
// the label HUD_SOLVED_LABEL (SOLVED), clear of the board, whose extent
// specs/board.md gives. TWO real solves put the count at 2, NEXT BOARD
// returns to playing, and the frame's text runs are read back: a run
// carrying the label, a run reading 2 beside it — within one CELL_PITCH,
// the spec's own unit of adjacent placement, or in the label's own run — and
// both clear of the current board's extent widened by NODE_R. Where the
// readout sits and how it is styled is the build's; only "beside" and "clear
// of the board" are measured.
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
  solveGenerated,
  tapAction,
  type Harness,
} from "../harness";
import { assertLabeledDigitClear, boardKeepOut } from "./helpers";

const SEED = 1;
/** Two solves: the count the label carries is 2, the tier still 1. */
const SOLVES = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws SOLVED with the figure 2 beside it, clear of the board", async () => {
  await solveGenerated(h, SOLVES, SEED);
  await tapAction(h, "confirm");
  const snapshot = h.snapshot();
  assertEqual(snapshot.screen, "playing", "back on playing after the solves");
  assertEqual(snapshot.solvedCount, SOLVES, "both solves are counted");

  h.calls.length = 0;
  await h.advance(1);
  // The count drawn beside its label.
  captureStill(h, "hud");

  assertLabeledDigitClear(
    drawnTextRuns(h),
    HUD_SOLVED_LABEL,
    SOLVES,
    boardKeepOut(snapshot.board),
  );
});
