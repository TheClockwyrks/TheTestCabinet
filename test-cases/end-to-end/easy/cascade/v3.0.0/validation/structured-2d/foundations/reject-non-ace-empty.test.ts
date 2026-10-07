// foundations/reject-non-ace-empty — an empty foundation refuses everything but an
// Ace.
//
// specs/foundations.md: a foundation holding nothing accepts an Ace, "and refuses
// every other card offered to it".
// specs/instrumentation.md: a refused `move` returns `false` and leaves the board
// unchanged.
//
// THE TWO CARDS. A 2 and a King, which are the two wrong models an empty foundation
// invites. A build that reached for the tableau's rule — an empty pile takes a King
// — accepts the King; a build that asked only whether the offered card is the next
// rank up from nothing, or that treated an empty foundation's top rank as zero,
// accepts the 2. Each is offered from its own column, so a build broken on one of
// them fails here whichever one it is, and the printed board says which card moved.
//
// Both are offered to the SAME empty foundation and every other foundation is empty
// too, so nothing on the table could have taken either card by another rule.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  KING,
  openTable,
  poseColumn,
  TWO,
  type Harness,
} from "../harness";
import { boardText } from "./board";

/** The empty foundation both cards are offered to. */
const FOUNDATION = 0;
/** The column the 2 waits in, and the card. */
const TWO_COLUMN = 1;
const TWO_CARD = card("spades", TWO);
const TWO_TEXT = "2S";
/** The column the King waits in, and the card. */
const KING_COLUMN = 3;
const KING_CARD = card("hearts", KING);
const KING_TEXT = "KH";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a 2 and a King on an empty foundation", async () => {
  openTable(h);
  poseColumn(h, TWO_COLUMN, [TWO_CARD]);
  poseColumn(h, KING_COLUMN, [KING_CARD]);
  const before = boardText(h.snapshot());

  const two = h.debug.move("tableau", TWO_COLUMN, 0, "foundation", FOUNDATION);
  const king = h.debug.move(
    "tableau",
    KING_COLUMN,
    0,
    "foundation",
    FOUNDATION,
  );
  const after = boardText(h.snapshot());
  await h.advance(1);
  captureStill(h, "refused");

  assertEqual(
    two,
    false,
    `move of ${TWO_TEXT} onto empty foundation ${FOUNDATION}, which accepts ` +
      "an Ace and nothing else (specs/foundations.md)",
  );
  assertEqual(
    king,
    false,
    `move of ${KING_TEXT} onto empty foundation ${FOUNDATION}: an empty ` +
      "COLUMN takes a King, an empty foundation does not " +
      "(specs/foundations.md)",
  );
  assertDeepEqual(
    after,
    before,
    "the board after the two refused moves: both cards are still in their " +
      "columns and every foundation is still empty " +
      "(specs/instrumentation.md)",
  );
});
