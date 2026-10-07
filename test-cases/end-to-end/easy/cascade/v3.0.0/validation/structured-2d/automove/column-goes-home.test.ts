// automove/column-goes-home — an auto-move sends a column's lowest face-up card
// home.
//
// specs/instrumentation.md: `autoMove(pile, index)` sends the named pile's playable
// card to the foundation it belongs on when that is legal, a column's playable card
// is its lowest face-up card, and the call returns `true` when the card went home.
// specs/foundations.md: the foundation whose top card is rank `r` of suit `s`
// accepts rank `r + 1` of that suit.
//
// THE POSE. One foundation started with the Ace of spades and one column holding the
// two of spades alone, so the column's lowest face-up card is unambiguous and no
// other card is on the table for a build to send instead. The column is index 3
// rather than 0, so a build that ignored the index and swept the tableau from the
// left would find nothing to send.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  ACE,
  captureStill,
  card,
  createHarness,
  openTable,
  poseColumn,
  poseFoundation,
  TWO,
  type Harness,
} from "../harness";
import { pileText } from "./board";

/** The foundation the Ace of spades starts. Any slot may hold any suit. */
const FOUNDATION = 0;
/** The suit in play, and the rank the foundation is built to: its Ace alone. */
const SUIT = "spades";
const FOUNDATION_UP_TO = ACE;
/** The foundation's top card, written out, as the board must read it. */
const FOUNDATION_TOP = "AS";
/** The column the card waits in, named away from the first slot on purpose. */
const COLUMN = 3;
/** That column's one card: one rank above the foundation's top, and of its suit. */
const COLUMN_CARD = card(SUIT, TWO);
const COLUMN_CARD_TEXT = "2S";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sends a column's lowest face-up card to the foundation it belongs on", async () => {
  openTable(h);
  poseFoundation(h, FOUNDATION, SUIT, FOUNDATION_UP_TO);
  poseColumn(h, COLUMN, [COLUMN_CARD]);

  const went = h.debug.autoMove("tableau", COLUMN);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "home");

  assertEqual(
    went,
    true,
    `autoMove("tableau", ${COLUMN}) with ${COLUMN_CARD_TEXT} lowest in that ` +
      `column and ${FOUNDATION_TOP} home, which is a legal auto-move ` +
      "(specs/instrumentation.md)",
  );
  assertDeepEqual(
    pileText(after.foundations[FOUNDATION]),
    [FOUNDATION_TOP, COLUMN_CARD_TEXT],
    `foundation ${FOUNDATION}, the one holding the next-lower card of the ` +
      "suit (specs/foundations.md)",
  );
  assertLength(
    after.tableau[COLUMN],
    0,
    `the cards left in column ${COLUMN}: the card that went home has left it ` +
      "(specs/tableau.md)",
  );
});
