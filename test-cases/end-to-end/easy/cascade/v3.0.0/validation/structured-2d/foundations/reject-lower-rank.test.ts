// foundations/reject-lower-rank — a foundation refuses a card below its top rank.
//
// specs/foundations.md: a foundation whose top card is rank `r` of suit `s` accepts
// the card of rank `r + 1` of that suit, and refuses every other card offered to it.
// A foundation builds UPWARD, so a card below its top rank is refused however close
// to it that rank is.
// specs/instrumentation.md: a refused `move` returns `false` and leaves the board
// unchanged.
//
// THE DISTINGUISHING RANK. The spade foundation is built to its five and the four of
// spades is offered: the right suit, one rank away, and the wrong way. This is the
// one card that separates a build comparing `card.rank === top.rank + 1` from one
// comparing `Math.abs(card.rank - top.rank) === 1`, which every other item in this
// group reads the same. `reject-rank-gap` covers the same distance in the other
// direction, so a build wrong in one direction alone grades differently from one
// wrong in both.
//
// WHY THE OFFERED CARD IS A SECOND FOUR OF SPADES. A foundation built by the rules
// holds every lower rank of its suit already, so the only way to OFFER one a lower
// rank of its own suit is a second copy of a card it holds. `addCard` appends one
// card with a fresh id (specs/instrumentation.md), and the rule under test asks what
// the foundation does with the card put in front of it, not how many of that card
// the deck holds; the check therefore reads the verdict and the board, never an id.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  FIVE,
  FOUR,
  openTable,
  poseColumn,
  poseFoundation,
  type Harness,
} from "../harness";
import { boardText } from "./board";

/** The started foundation, its suit, and the rank it is built to. */
const FOUNDATION = 0;
const FOUNDATION_SUIT = "spades";
const FOUNDATION_TOP_RANK = FIVE;
/** The column the lower card waits in. */
const COLUMN = 6;
/** One rank BELOW the foundation's top card, and of its suit. */
const LOWER = card(FOUNDATION_SUIT, FOUR);
const LOWER_TEXT = "4S";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a card one rank below the foundation's top card", async () => {
  openTable(h);
  poseFoundation(h, FOUNDATION, FOUNDATION_SUIT, FOUNDATION_TOP_RANK);
  poseColumn(h, COLUMN, [LOWER]);
  const before = boardText(h.snapshot());

  const accepted = h.debug.move("tableau", COLUMN, 0, "foundation", FOUNDATION);
  const after = boardText(h.snapshot());
  await h.advance(1);
  captureStill(h, "refused");

  assertEqual(
    accepted,
    false,
    `move of ${LOWER_TEXT} onto the ${FOUNDATION_SUIT} foundation built to ` +
      `its ${FOUNDATION_TOP_RANK}: a foundation builds upward, and takes the ` +
      "rank above its top card alone (specs/foundations.md)",
  );
  assertDeepEqual(
    after,
    before,
    "the board after the refused move: the lower card is still in its column " +
      "and the foundation still holds five (specs/instrumentation.md)",
  );
});
