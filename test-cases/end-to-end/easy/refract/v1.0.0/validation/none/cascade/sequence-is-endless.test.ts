// cascade/sequence-is-endless — the sequence has no last board.
//
// specs/modes/cascade.md: "MAX_TIER is the top of the ladder and holds from the
// twentieth board solved onward. Play continues there indefinitely, on fresh
// boards each time", and "solving a board hands the player the next one...
// There is no last board." Read as far as a suite can honestly read an
// "indefinitely": the run is posed past the twentieth solve through
// `setSolvedCount` and `setTier` (specs/instrumentation.md), and five more
// times over a posed board is solved and NEXT BOARD taken. Each solve must
// raise solvedCount by one and hold the tier at MAX_TIER, and each NEXT BOARD
// must hand over a board that keeps the generator's contract (notation.ts's
// validateBoard, the structural legality of specs/board.md and the generator
// table) carrying MAX_TIER's channel count.
//
// The board solved each time is the minimal board, posed through `loadBoard`
// over whatever NEXT BOARD dealt: "a board posed this way is a board like any
// other" (specs/instrumentation.md), so the solve counts exactly as a generated
// one would, and the generator's own boards are what NEXT BOARD is read on.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  MAX_TIER,
  TIER_ADVANCE,
  TIERS,
  channelsPresent,
  validateBoard,
} from "../notation";
import {
  boardFromSnapshot,
  captureStill,
  createHarness,
  fireAction,
  poseCascadeRun,
  solvePosedBoard,
  type Harness,
} from "../harness";

/** The twentieth solve is where the ladder tops out. */
const TOP = TIER_ADVANCE * (MAX_TIER - 1);
/** How far past the top the sequence is driven. */
const BEYOND = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("past the twentieth solve, each solve counts at MAX_TIER and NEXT BOARD keeps producing boards", async () => {
  await poseCascadeRun(h, TOP);

  for (let index = 0; index < BEYOND; index += 1) {
    const solved = TOP + index + 1;
    const after = await solvePosedBoard(h);
    assertEqual(
      after.solved,
      true,
      `precondition: the board posed for solve ${solved} solves`,
    );
    assertEqual(
      after.solvedCount,
      solved,
      `after solve ${solved}: solvedCount keeps rising by one`,
    );
    assertEqual(
      after.tier,
      MAX_TIER,
      `after solve ${solved}: the tier holds at MAX_TIER`,
    );

    // First choice, highlighted on arrival: NEXT BOARD.
    await fireAction(h, "confirm");
    const next = await h.snapshot();
    const at = `board ${solved + 1}, past the twentieth solve`;
    assertEqual(
      next.screen,
      "playing",
      `${at}: NEXT BOARD keeps the sequence going`,
    );
    const board = boardFromSnapshot(next);
    assertDeepEqual(
      validateBoard(board),
      [],
      `${at}: a well-formed board (violations)`,
    );
    assertEqual(
      channelsPresent(board).length,
      TIERS[MAX_TIER - 1].channels,
      `${at}: generated at MAX_TIER, carrying its channel count`,
    );
  }

  // A fresh board deep into the sequence, as NEXT BOARD dealt it.
  await captureStill(h, "board");
});
