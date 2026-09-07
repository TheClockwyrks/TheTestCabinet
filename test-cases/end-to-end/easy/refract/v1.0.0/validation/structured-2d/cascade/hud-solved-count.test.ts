// Refract — cascade/hud-solved-count: the boards-solved count is on screen
// while playing.
//
// specs/modes/cascade.md "The count": during `playing`, show the count beside
// the label HUD_SOLVED_LABEL (SOLVED), clear of the board in play, whose
// extent specs/board.md gives for its own cols and rows, widened by NODE_R.
// The run is posed at two solves through `setSolvedCount` and `setTier`
// (specs/instrumentation.md) and a board is posed into play, so the count
// while playing is 2; the next playing frame's text runs are read back, and
// one of them must be the label with the figure 2 beside it — within
// HUD_VALUE_GAP (96) — the pair clear of the extent of the board in play.
// cascade/helpers.ts states both readings.
//
// WHY TWO SOLVES AND NOT ONE. After one solve the count and the tier both
// read 1, so a build that drew only "TIER 1" beside a bare SOLVED label would
// satisfy this point without ever showing the count. Two solves separate the
// two figures — the tier is still 1 at two solves (specs/modes/cascade.md's
// ladder) — so the 2 this reads can only be the boards-solved count.
//
// The frame's text is read as COALESCED RUNS rather than as raw `fillText`
// calls, because a build is free to letter-space its HUD and canvas has no
// portable property for it, so tracked copy is drawn a glyph at a time.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HUD_SOLVED_LABEL } from "../constants";
import { GEO_3X3 } from "../fixtures";
import {
  captureStill,
  createHarness,
  drawnTextRuns,
  loadBoard,
  poseCascadeRun,
  resetTo,
  type Harness,
} from "../harness";
import { assertLabeledDigitClear, boardKeepOut } from "./helpers";

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
  await resetTo(h);
  poseCascadeRun(h, SOLVES);
  await loadBoard(h, GEO_3X3);
  const snapshot = h.snapshot();
  assertEqual(snapshot.screen, "playing", "a board in play");
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
