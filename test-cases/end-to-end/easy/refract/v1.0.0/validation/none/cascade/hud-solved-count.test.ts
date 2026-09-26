// cascade/hud-solved-count — the boards-solved count is on screen while
// playing.
//
// specs/modes/cascade.md "The count": during playing, "show the count beside
// the label HUD_SOLVED_LABEL (SOLVED)", sitting "clear of the board in play,
// whose extent is the box its own cell centers span, given in specs/board.md,
// widened by NODE_R on every side". The run is posed at two solves through
// `setSolvedCount` and `setTier` (specs/instrumentation.md) and a board is
// posed into play, so the count on screen is 2 rather than the 0 a build might
// paint unconditionally; the frame's text runs must then carry the label with
// the figure 2 beside it — in the label's own run, or in a numbers run within
// HUD_VALUE_GAP (96) of it — with both runs clear of the extent of the BOARD IN
// PLAY, its own cell-center span widened by NODE_R.
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
import { assertEqual, assertGreaterThan } from "../assert";
import { HUD_SOLVED_LABEL } from "../constants";
import { GEO_3X3 } from "../fixtures";
import {
  captureStill,
  createHarness,
  drawnTextRuns,
  loadBoard,
  poseCascadeRun,
  type Harness,
} from "../harness";
import { boardKeepOut, findReadouts, runClearOf } from "./readouts";

/** Two solves: the count reads 2 while the tier still reads 1. */
const SOLVES = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws SOLVED with the figure 2 beside it, clear of the board's extent", async () => {
  await poseCascadeRun(h, SOLVES);
  await loadBoard(h, GEO_3X3);
  const playing = await h.snapshot();
  assertEqual(playing.screen, "playing", "precondition: a board in play");
  assertEqual(playing.solvedCount, SOLVES, "precondition: two boards solved");

  const calls = await h.frameCalls();
  await captureStill(h, "hud");

  const keepOut = boardKeepOut(playing.board);
  const readouts = findReadouts(
    drawnTextRuns(calls),
    HUD_SOLVED_LABEL,
    SOLVES,
  ).filter(
    (readout) =>
      runClearOf(readout.label, keepOut) && runClearOf(readout.value, keepOut),
  );
  assertGreaterThan(
    readouts.length,
    0,
    `a ${HUD_SOLVED_LABEL} readout of ${SOLVES}, clear of the board in play (x ` +
      `${keepOut.left}..${keepOut.right}, y ${keepOut.top}..${keepOut.bottom})`,
  );
});
