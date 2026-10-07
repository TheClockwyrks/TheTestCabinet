// foundations/accepts-from-waste — a foundation accepts the waste's top card.
//
// specs/foundations.md: "A foundation accepts a card from a tableau column and from
// the waste, on exactly the terms above" — the terms being the next rank up of its
// own suit.
// specs/stock.md: only the waste's top card may be played, onto a foundation that
// accepts it; once the top card has left, the card beneath it is the waste's top
// card.
// specs/instrumentation.md: `move` returns `true` when the rules accepted it.
//
// THE POSE. The spade foundation is built to its five and the waste holds two cards,
// its top card the six of spades, so the acceptance turns on the same rule
// `build-up-same-suit` reads and the only thing this item changes is where the card
// came from. A build that wired its foundation drop to the columns alone refuses it
// and fails here.
//
// The waste is posed with its set memory, two turned sets of one, because a waste
// whose set memory is empty shows no card and offers none to play (specs/stock.md):
// a pose without it would be asking the build to play a card the specification says
// is not there. What the memory does afterwards belongs to the `stock` group; this
// check reads the foundation and the cards on the waste.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  FIVE,
  NINE,
  openTable,
  poseFoundation,
  poseWaste,
  SIX,
  type Harness,
} from "../harness";
import { builtText, pileText } from "./board";

/** The started foundation, its suit, and the rank it is built to. */
const FOUNDATION = 0;
const FOUNDATION_SUIT = "spades";
const FOUNDATION_TOP_RANK = FIVE;
/** The waste, bottom card first: a buried card and the playable top card. */
const WASTE = [card("diamonds", NINE), card(FOUNDATION_SUIT, SIX)];
const WASTE_TEXT = ["9D", "6S"];
/** One turned set per card, so the waste shows the card the move plays. */
const WASTE_SETS = [1, 1];
/** The top card's row on the waste, counted from the bottom. */
const TOP_ROW = WASTE.length - 1;
/** The foundation once the move has landed. */
const BUILT = builtText(FOUNDATION_SUIT, SIX);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("accepts the waste's top card onto the foundation it belongs on", async () => {
  openTable(h);
  poseFoundation(h, FOUNDATION, FOUNDATION_SUIT, FOUNDATION_TOP_RANK);
  poseWaste(h, WASTE, WASTE_SETS);

  const accepted = h.debug.move("waste", 0, TOP_ROW, "foundation", FOUNDATION);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "accepted");

  assertEqual(
    accepted,
    true,
    `move of the waste's top card ${WASTE_TEXT[TOP_ROW]} onto the ` +
      `${FOUNDATION_SUIT} foundation built to its ${FOUNDATION_TOP_RANK}: a ` +
      "foundation accepts from the waste on the same terms " +
      "(specs/foundations.md)",
  );
  assertDeepEqual(
    pileText(after.foundations[FOUNDATION]),
    BUILT,
    `foundation ${FOUNDATION} after the move: the waste's card on top of it ` +
      "(specs/foundations.md)",
  );
  assertDeepEqual(
    pileText(after.waste),
    WASTE_TEXT.slice(0, TOP_ROW),
    "the cards left on the waste: the played card has left it and the card " +
      "beneath it is the top card (specs/stock.md)",
  );
});
