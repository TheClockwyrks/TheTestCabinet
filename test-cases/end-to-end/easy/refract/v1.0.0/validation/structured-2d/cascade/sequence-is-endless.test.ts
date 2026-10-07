// Refract — cascade/sequence-is-endless: the sequence has no last board.
//
// specs/modes/cascade.md: MAX_TIER is the top of the ladder and holds from the
// twentieth board solved onward — play continues there indefinitely, on fresh
// boards each time. The run is posed past the twentieth solve through
// `setSolvedCount` and `setTier` (specs/instrumentation.md), and five more
// times over a posed board is solved and NEXT BOARD taken. Each solve raises
// solvedCount by one and holds the tier at MAX_TIER, and each NEXT BOARD
// hands over a fresh, well-formed board carrying MAX_TIER's channel count —
// no last board, no stall, no plateau in the count.
//
// The board solved each time is the minimal board, posed through `loadBoard`
// over whatever NEXT BOARD dealt: "a board posed this way is a board like any
// other" (specs/instrumentation.md), so the solve counts exactly as a generated
// one would, and the generator's own boards are what NEXT BOARD is read on.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  boardFromSnapshot,
  captureStill,
  createHarness,
  poseCascadeRun,
  resetTo,
  solvePosedBoard,
  tapAction,
  type Harness,
} from "../harness";
import { MAX_TIER, TIER_ADVANCE, TIERS, channelsPresent } from "../notation";
import { assertGeneratedBoardWellFormed } from "./helpers";

/** The twentieth solve is where the ladder tops out. */
const TOP = TIER_ADVANCE * (MAX_TIER - 1);
/** How far past the top the sequence is driven. */
const BEYOND = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps producing boards at MAX_TIER, the count rising one per solve", async () => {
  await resetTo(h);
  poseCascadeRun(h, TOP);

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
      `solvedCount keeps rising one per solve at solve ${solved}`,
    );
    assertEqual(after.tier, MAX_TIER, `solve ${solved} holds at MAX_TIER`);

    await h.advance(1);
    await tapAction(h, "confirm");
    const next = h.snapshot();
    const at = `board ${solved + 1}, past the top of the ladder`;
    assertEqual(
      next.screen,
      "playing",
      `${at}: NEXT BOARD keeps the sequence going`,
    );
    const board = boardFromSnapshot(next);
    assertGeneratedBoardWellFormed(board, at);
    assertEqual(
      channelsPresent(board).length,
      TIERS[MAX_TIER - 1].channels,
      `${at}: generated at MAX_TIER, carrying its channel count`,
    );
  }

  // A fresh board deep into the sequence.
  captureStill(h, "board");
});
