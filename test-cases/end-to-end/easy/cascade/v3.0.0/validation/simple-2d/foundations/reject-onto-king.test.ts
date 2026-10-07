// foundations/reject-onto-king — a completed foundation accepts nothing.
//
// specs/foundations.md: "The foundation holds / Its King | It accepts / Nothing." A
// foundation is complete when it holds thirteen cards, and from then on every card
// offered to it is refused.
// specs/instrumentation.md: a refused `move` returns `false` and leaves the board
// unchanged.
//
// THE DISTINGUISHING CARD IS AN ACE. There is no rank above a King, so a build that
// tests `card.rank === top.rank + 1` refuses everything here without ever having
// thought about completion, and any card would pass it. The card that separates the
// models is an ACE: a build whose acceptance test asks "is it an Ace?" before it
// asks whether the foundation is empty takes it, and one that asks about the pile
// first refuses it. So the Ace of hearts is offered to a foundation completed in
// spades, and a build that lets it land fails.
//
// The Ace is of ANOTHER suit because every spade is already on the completed
// foundation. It would be accepted by any of the three empty foundations, and the
// move names foundation 0, so this also refuses a build that routes a `move` to the
// pile it thinks the card belongs on instead of the pile it was told.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  poseColumn,
  poseFoundation,
  type Harness,
} from "../harness";
import { boardSpecs } from "./board";

/** The completed foundation, and the rank it is built to: its King. */
const FOUNDATION = 0;
const FOUNDATION_TOP_RANK = 13;
/** The column the offered card waits in. */
const COLUMN = 5;
/** An Ace, which an empty foundation takes and a completed one must not. */
const OFFERED = "AH";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a card offered to a foundation holding its King", async () => {
  openTable(h);
  poseFoundation(h, FOUNDATION, "spades", FOUNDATION_TOP_RANK);
  poseColumn(h, COLUMN, [OFFERED]);
  const before = boardSpecs(h.snapshot());

  const accepted = h.debug.move("tableau", COLUMN, 0, "foundation", FOUNDATION);
  const after = boardSpecs(h.snapshot());
  await h.advance(1);
  captureStill(h, "refused");

  assertEqual(
    accepted,
    false,
    `move of ${OFFERED} onto the spade foundation holding its King, which ` +
      "accepts nothing (specs/foundations.md)",
  );
  assertDeepEqual(
    after,
    before,
    "the board after the refused move: the card is still in its column, the " +
      "completed foundation still holds thirteen, and no other foundation " +
      "took it (specs/instrumentation.md)",
  );
});
