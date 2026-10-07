// deal/waste-empty — a deal leaves the waste empty, and its set memory with it.
//
// THE RULE. specs/deal.md: "The waste starts empty, with no sets in its memory."
// specs/instrumentation.md says the same thing of the operation that performs a
// deal: `deal()` "replaces the contents of all thirteen piles" and "empties the
// waste's set memory". A waste that survived a deal would offer the player a card
// from the game before it.
//
// THE WASTE IS POSED FULL FIRST, deliberately. An empty table is already empty, so
// a check that dealt onto one would pass for a build whose deal never touches the
// waste at all. So three cards and two turned sets are posed onto the waste before
// the deal runs, and what the deal is then asked for is the REPLACEMENT
// specs/deal.md describes rather than the absence of anything to replace.
//
// TWO READINGS, ONE REQUIREMENT. The cards and the set memory are two halves of
// the same sentence in specs/deal.md, and a waste holding cards with no sets shows
// none of them (specs/stock.md), so a build that cleared one and not the other has
// left the player a waste that is half there either way. They are asserted
// together, cards first.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  poseWaste,
  type Harness,
} from "../harness";

/**
 * The waste the deal is asked to replace: three cards, remembered as a set of two
 * turned before a set of one. Any non-empty waste with a non-empty memory would do;
 * this one is small enough to read and carries more than one set, so a deal that
 * dropped only the newest is caught.
 */
const POSED_WASTE = ["2C", "9H", "4S"] as const;
const POSED_SETS = [2, 1] as const;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("empties a waste and its set memory when it deals", async () => {
  openTable(harness);
  poseWaste(harness, POSED_WASTE, POSED_SETS);
  harness.debug.deal();

  await harness.advance(1);
  captureStill(harness, "dealt");

  const dealt = harness.snapshot();
  assertLength(
    dealt.waste,
    0,
    "cards on the waste a deal leaves (specs/deal.md)",
  );
  assertLength(
    dealt.wasteSets,
    0,
    "sets in the waste's memory a deal leaves (specs/deal.md)",
  );
});
