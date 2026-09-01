// deal/foundations-empty — a deal leaves all four foundations empty.
//
// THE RULE. specs/deal.md: "all `FOUNDATION_COUNT` (`4`) foundations start empty".
// specs/instrumentation.md says the same of the operation: `deal()` replaces the
// contents of all thirteen piles. A foundation that survived a deal would start the
// new game part-won, and the win test would fire against cards the player never
// played.
//
// A FOUNDATION IS POSED FIRST, deliberately. An empty table is already empty, so a
// check that dealt onto one would pass for a build whose deal never touches the
// foundations. Three cards are built up on foundation `1` before the deal runs, and
// what the deal is then asked for is the REPLACEMENT specs/deal.md describes.
//
// The pile the cards are posed on is `1` rather than `0`, so a build that clears
// only the first foundation is caught here rather than passing.
//
// ALL FOUR ARE READ, each naming its own index, and the count of foundations is
// read with them: `FOUNDATION_COUNT` is the figure specs/deal.md fixes and a build
// reporting some other number of foundations has not dealt the board the rules
// describe.

import { afterEach, beforeEach, it } from "vitest";
import { FOUNDATION_COUNT } from "../../src/constants";
import { assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  pileOf,
  poseFoundation,
  THREE,
  type Harness,
} from "../harness";

/** The foundation posed before the deal, and the rank its suit is built up to. */
const POSED_FOUNDATION = 1;
const POSED_UP_TO = THREE;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("empties every foundation when it deals", async () => {
  openTable(harness);
  poseFoundation(harness, POSED_FOUNDATION, "hearts", POSED_UP_TO);
  harness.debug.deal();

  await harness.advance(1);
  captureStill(harness, "dealt");

  const dealt = harness.snapshot();
  assertLength(
    dealt.foundations,
    FOUNDATION_COUNT,
    "foundations on the table a deal laid out (specs/deal.md)",
  );
  for (let index = 0; index < FOUNDATION_COUNT; index += 1) {
    assertLength(
      pileOf(dealt, "foundation", index),
      0,
      `cards on foundation ${index} after a deal (specs/deal.md)`,
    );
  }
});
