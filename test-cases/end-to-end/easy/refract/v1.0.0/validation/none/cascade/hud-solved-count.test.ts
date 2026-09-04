// cascade/hud-solved-count — the boards-solved count is on screen while
// playing.
//
// specs/modes/cascade.md "The count": during playing, "show the count beside
// the label HUD_SOLVED_LABEL (SOLVED)", sitting "clear of the board, whose
// extent is given in specs/board.md". TWO boards are genuinely solved and the
// next entered, so the count on screen is 2 rather than the 0 a build might
// paint unconditionally; the frame's text runs must then carry the label with
// the figure 2 beside it (either in the label's own run or in a numbers run
// anchored within readouts.ts's adjacency), with both anchors outside the
// largest board's extent widened by NODE_R (constants.ts BOARD_EXTENT).
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
import { assertEqual, assertGreaterThan } from "../assert";
import { HUD_SOLVED_LABEL } from "../constants";
import {
  captureStill,
  createHarness,
  fireAction,
  drawnTextRuns,
  solveGenerated,
  type Harness,
} from "../harness";
import { findReadouts, outsideBoardExtent } from "./readouts";

const SEED = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws SOLVED with the figure 2 beside it, clear of the board's extent", async () => {
  const sweep = await solveGenerated(h, 2, SEED);
  for (const [index, after] of sweep.afterSolve.entries()) {
    assertEqual(
      after.solved,
      true,
      `precondition: board ${index + 1} solved (see boards-are-solvable)`,
    );
  }
  await fireAction(h, "confirm");
  const playing = await h.snapshot();
  assertEqual(
    playing.screen,
    "playing",
    "precondition: the next board in play",
  );
  assertEqual(playing.solvedCount, 2, "precondition: two boards solved");

  const calls = await h.frameCalls();
  await captureStill(h, "hud");

  const readouts = findReadouts(
    drawnTextRuns(calls),
    HUD_SOLVED_LABEL,
    2,
  ).filter(
    (readout) =>
      outsideBoardExtent(readout.label) && outsideBoardExtent(readout.value),
  );
  assertGreaterThan(
    readouts.length,
    0,
    `a ${HUD_SOLVED_LABEL} readout of 2, clear of the board's extent`,
  );
});
