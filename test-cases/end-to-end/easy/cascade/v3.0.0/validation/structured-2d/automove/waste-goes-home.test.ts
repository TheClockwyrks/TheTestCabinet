// automove/waste-goes-home — an auto-move sends the waste's top card home.
//
// specs/instrumentation.md: `autoMove(pile, index)` sends the named pile's playable
// card to the foundation it belongs on when that is legal, the waste's playable card
// is its top card, and the call returns `true` when the card went home.
// specs/foundations.md: the foundation whose top card is rank `r` of suit `s`
// accepts rank `r + 1` of that suit, and that is the foundation the card belongs on.
//
// THE POSE IS THE SMALLEST TABLE THE RULE NEEDS. One foundation started with the Ace
// of spades, and the two of spades alone on the waste, given a set of one so the
// waste shows it (specs/stock.md: a waste whose set memory is empty shows no card
// and offers none to play). Every other pile is empty, so there is no other card a
// build could have sent and no other foundation the two of spades belongs on.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  ACE,
  captureStill,
  card,
  createHarness,
  openTable,
  poseFoundation,
  poseWaste,
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
/** The waste's one card: one rank above that top, and of its suit. */
const WASTE_TOP = card(SUIT, TWO);
const WASTE_TOP_TEXT = "2S";
/** The one set the waste's card belongs to, which is what makes it shown. */
const WASTE_SETS = [1];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sends the waste's top card to the foundation it belongs on", async () => {
  openTable(h);
  poseFoundation(h, FOUNDATION, SUIT, FOUNDATION_UP_TO);
  poseWaste(h, [WASTE_TOP], WASTE_SETS);

  const went = h.debug.autoMove("waste", 0);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "home");

  assertEqual(
    went,
    true,
    `autoMove("waste", 0) with ${WASTE_TOP_TEXT} on the waste and ` +
      `${FOUNDATION_TOP} home, which is a legal auto-move ` +
      "(specs/instrumentation.md)",
  );
  assertDeepEqual(
    pileText(after.foundations[FOUNDATION]),
    [FOUNDATION_TOP, WASTE_TOP_TEXT],
    `foundation ${FOUNDATION}, the one holding the next-lower card of the ` +
      "suit (specs/foundations.md)",
  );
  assertLength(
    after.waste,
    0,
    "the cards left on the waste: the card that went home has left it " +
      "(specs/stock.md)",
  );
});
