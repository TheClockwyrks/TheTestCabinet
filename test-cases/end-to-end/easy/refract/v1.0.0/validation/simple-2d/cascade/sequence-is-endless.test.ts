// Refract — cascade/sequence-is-endless: the sequence has no last board.
//
// specs/modes/cascade.md: MAX_TIER holds from the twentieth board solved
// onward, and play continues there indefinitely, on fresh boards each time —
// there is no last board. Indefinitely is not testable; what is testable is
// that nothing ends at the top: the run is posed past the twentieth solve
// through `setSolvedCount` and `setTier` (specs/instrumentation.md), and five
// more times over a posed board is solved and NEXT BOARD taken. Each solve
// must raise solvedCount by one and hold the tier at MAX_TIER, and each NEXT
// BOARD must hand over a board that keeps the generator's contract, carrying
// MAX_TIER's channel count. The still is a fresh board deep into the sequence,
// five boards past the ladder's top.
//
// The board solved each time is the minimal board, posed through `loadBoard`
// over whatever NEXT BOARD dealt: "a board posed this way is a board like any
// other" (specs/instrumentation.md), so the solve counts exactly as a generated
// one would, and the generator's own boards are what NEXT BOARD is read on.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  oracleBoard,
  poseCascadeRun,
  resetTo,
  solvePosedBoard,
  tapAction,
  type Harness,
} from "../harness";
import { MAX_TIER, TIER_ADVANCE, TIERS, channelsPresent } from "../notation";
import {
  assertCrystalChargesInRange,
  assertFitsGrid,
  assertTwoEmittersPerChannel,
} from "./sweep";

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

it("keeps counting solves at MAX_TIER and producing well-formed boards past the twentieth solve", async () => {
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
      `after solve ${solved}: solvedCount keeps rising by one per board ` +
        "solved (specs/modes/cascade.md)",
    );
    assertEqual(
      after.tier,
      MAX_TIER,
      `after solve ${solved}: the tier holds at MAX_TIER`,
    );

    await h.advance(1);
    await tapAction(h, "confirm"); // NEXT BOARD (specs/modes/cascade.md)
    const next = h.snapshot();
    const at = `board ${solved + 1}, past the twentieth solve`;
    assertEqual(
      next.screen,
      "playing",
      `${at}: NEXT BOARD keeps the sequence going`,
    );
    const board = oracleBoard(next);
    assertFitsGrid(board, at);
    assertTwoEmittersPerChannel(board, at);
    assertCrystalChargesInRange(board, at);
    assertEqual(
      channelsPresent(board).length,
      TIERS[MAX_TIER - 1].channels,
      `${at}: generated at MAX_TIER, carrying its channel count`,
    );
  }

  await h.advance(1);
  captureStill(h, "board");
});
