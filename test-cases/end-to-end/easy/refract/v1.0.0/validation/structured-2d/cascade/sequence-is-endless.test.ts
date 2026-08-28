// Refract — cascade/sequence-is-endless: the sequence has no last board.
//
// specs/modes/cascade.md: MAX_TIER is the top of the ladder and holds from the
// sixteenth board solved onward — play continues there indefinitely, on fresh
// boards each time. The sweep drives PAST the top: twenty-two boards solved in
// a row, so six arrive after the ladder has topped out. Each of those arrives
// well formed at MAX_TIER with solvedCount one higher than the board before,
// and NEXT BOARD still hands over a fresh, well-formed board afterwards — no
// last board, no stall, no plateau in the count.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  boardFromSnapshot,
  captureStill,
  createHarness,
  solveGenerated,
  tapAction,
  type Harness,
} from "../harness";
import { MAX_TIER, TIER_ADVANCE } from "../notation";
import { assertGeneratedBoardWellFormed } from "./helpers";

const SEED = 1;
/** Six boards past the sixteenth solve, where the ladder tops out. */
const BOARDS = TIER_ADVANCE * (MAX_TIER - 1) + 6;
const FIRST_TOP_TIER_BOARD = TIER_ADVANCE * (MAX_TIER - 1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps producing boards at MAX_TIER, the count rising one per solve", async () => {
  const solved = await solveGenerated(h, BOARDS, SEED);

  for (let k = FIRST_TOP_TIER_BOARD; k < solved.length; k += 1) {
    const { arrival, board } = solved[k];
    assertEqual(
      arrival.solvedCount,
      k,
      `solvedCount keeps rising one per solve at board ${k + 1}`,
    );
    assertEqual(arrival.tier, MAX_TIER, `board ${k + 1} arrives at MAX_TIER`);
    assertGeneratedBoardWellFormed(
      board,
      `board ${k + 1}, past the top of the ladder`,
    );
  }
  assertEqual(h.snapshot().solvedCount, BOARDS, "every solve counted");

  // Deeper still: NEXT BOARD after the sweep hands over yet another board.
  await tapAction(h, "confirm");
  const deeper = h.snapshot();
  assertEqual(deeper.screen, "playing", "NEXT BOARD keeps the sequence going");
  // A fresh board deep into the sequence.
  captureStill(h, "board");
  assertGeneratedBoardWellFormed(
    boardFromSnapshot(deeper),
    `board ${BOARDS + 1}`,
  );
});
