// cascade/hud-solved-count — the boards-solved count is on screen while
// playing.
//
// specs/modes/cascade.md "The count": during playing, "show the count beside
// the label HUD_SOLVED_LABEL (SOLVED)", sitting "clear of the board, whose
// extent is given in specs/board.md". One board is genuinely solved and the
// next entered, so the count on screen is 1 rather than the 0 a build might
// paint unconditionally; the frame's text draws must then carry the label with
// the digit 1 beside it (either in the label's own run or in a digits run
// anchored within readouts.ts's adjacency), with both anchors outside the
// largest board's extent widened by NODE_R (constants.ts BOARD_EXTENT).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { HUD_SOLVED_LABEL } from "../constants";
import {
  captureStill,
  createHarness,
  fireAction,
  solveGenerated,
  textDraws,
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

it("draws SOLVED with the digit 1 beside it, clear of the board's extent", async () => {
  const sweep = await solveGenerated(h, 1, SEED);
  assertEqual(
    sweep.afterSolve[0].solved,
    true,
    "precondition: the first board solved (see boards-are-solvable)",
  );
  await fireAction(h, "confirm");
  const playing = await h.snapshot();
  assertEqual(
    playing.screen,
    "playing",
    "precondition: the next board in play",
  );
  assertEqual(playing.solvedCount, 1, "precondition: one board solved");

  const calls = await h.frameCalls();
  await captureStill(h, "hud");

  const readouts = findReadouts(textDraws(calls), HUD_SOLVED_LABEL, 1).filter(
    (readout) =>
      outsideBoardExtent(readout.label) && outsideBoardExtent(readout.value),
  );
  assertGreaterThan(
    readouts.length,
    0,
    `a ${HUD_SOLVED_LABEL} readout of 1, clear of the board's extent`,
  );
});
