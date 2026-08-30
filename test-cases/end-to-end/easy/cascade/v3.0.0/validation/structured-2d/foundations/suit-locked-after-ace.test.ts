// foundations/suit-locked-after-ace — a foundation is locked to its suit from its
// first card.
//
// specs/foundations.md: "Once a foundation holds a card it is locked to that card's
// suit, and a card of any other suit is refused for as long as the foundation holds
// cards." The card it does accept is the next rank up of that same suit.
// specs/instrumentation.md: `move` returns `true` when the rules accepted it and
// `false` when they refused it, and a refused move leaves the board unchanged.
//
// THE LOCK IS READ FROM THE ACE ALONE. The spade foundation holds one card, its Ace,
// and two 2s wait in columns: the 2 of clubs and the 2 of spades. Both are black and
// both are the next rank up, so the only thing separating them is the suit — which
// is what "locked" means. A build that locks a foundation only once it holds two or
// more cards, or that locks it to a COLOR, takes the 2 of clubs and fails.
//
// The refusal is read first and the acceptance second, from the same pose, so the
// acceptance is the control that says the refusal was about the suit rather than
// about the foundation refusing everything. A build broken in one direction alone
// still fails, and the failing line names which.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  ACE,
  captureStill,
  card,
  createHarness,
  openTable,
  poseColumn,
  poseFoundation,
  sameColorSuit,
  TWO,
  type Harness,
} from "../harness";
import { boardText, builtText, pileText } from "./board";

/** The foundation started with its Ace, its suit, and the rank it is built to. */
const FOUNDATION = 0;
const FOUNDATION_SUIT = "spades";
const FOUNDATION_TOP_RANK = ACE;
/** The column the off-suit 2 waits in, and the card: black, like the Ace. */
const OFF_COLUMN = 1;
const OFF_SUIT = card(sameColorSuit(FOUNDATION_SUIT), TWO);
const OFF_SUIT_TEXT = "2C";
/** The column the foundation's own 2 waits in, and the card. */
const OWN_COLUMN = 2;
const OWN_SUIT = card(FOUNDATION_SUIT, TWO);
const OWN_SUIT_TEXT = "2S";
/** The foundation once its own 2 has landed. */
const BUILT = builtText(FOUNDATION_SUIT, TWO);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses another suit's 2 and accepts its own", async () => {
  openTable(h);
  poseFoundation(h, FOUNDATION, FOUNDATION_SUIT, FOUNDATION_TOP_RANK);
  poseColumn(h, OFF_COLUMN, [OFF_SUIT]);
  poseColumn(h, OWN_COLUMN, [OWN_SUIT]);
  const before = boardText(h.snapshot());

  const off = h.debug.move("tableau", OFF_COLUMN, 0, "foundation", FOUNDATION);
  const afterRefusal = boardText(h.snapshot());
  const own = h.debug.move("tableau", OWN_COLUMN, 0, "foundation", FOUNDATION);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "locked");

  assertEqual(
    off,
    false,
    `move of ${OFF_SUIT_TEXT} onto a foundation holding the Ace of ` +
      `${FOUNDATION_SUIT}, which is locked to that suit from that card on ` +
      "(specs/foundations.md)",
  );
  assertDeepEqual(
    afterRefusal,
    before,
    "the board after the refused move: the off-suit 2 is still in its column " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    own,
    true,
    `move of ${OWN_SUIT_TEXT} onto the same foundation: the next rank up of ` +
      "the suit it is locked to (specs/foundations.md)",
  );
  assertDeepEqual(
    pileText(after.foundations[FOUNDATION]),
    BUILT,
    `foundation ${FOUNDATION} at the end: its own 2 on its Ace, and the ` +
      "off-suit 2 nowhere on it (specs/foundations.md)",
  );
});
