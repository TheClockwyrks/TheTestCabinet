// Refract — cascade/sequence-is-endless: the sequence has no last board.
//
// specs/modes/cascade.md: MAX_TIER holds from the sixteenth board solved
// onward, and play continues there indefinitely, on fresh boards each time —
// there is no last board. Indefinitely is not testable; what is testable is
// that nothing ends at the top: the sweep really solves sixteen boards to
// reach MAX_TIER, then keeps taking NEXT BOARD and holds every board past
// that point to the generator's contract, with solvedCount rising by one per
// board solved (17..21). The still is a fresh board deep into the sequence,
// four boards past the ladder's top.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  oracleBoard,
  resetTo,
  startCascade,
  type Harness,
} from "../harness";
import { assertWellFormed, sweepGenerated } from "./sweep";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps producing well-formed boards past the sixteenth solve, counting each", async () => {
  await resetTo(h, 1);
  await startCascade(h);

  await sweepGenerated(h, 21, {
    onBoard: (snapshot, round) => {
      if (round <= 16) return;
      if (round === 20) captureStill(h, "board");
      assertWellFormed(
        oracleBoard(snapshot),
        `board ${round}, past the sixteenth solve`,
      );
    },
    onSolved: (snapshot, round) => {
      if (round <= 16) return;
      assertEqual(
        snapshot.solvedCount,
        round,
        `after solve ${round}: solvedCount keeps rising by one per board ` +
          "solved (specs/modes/cascade.md)",
      );
    },
  });
});
