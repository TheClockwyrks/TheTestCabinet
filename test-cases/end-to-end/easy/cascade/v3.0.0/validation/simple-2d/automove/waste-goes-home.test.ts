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
// waste shows it (specs/stock.md: a waste whose set memory is empty offers no card
// to play). Every other pile is empty, so there is no other card a build could have
// sent and no other foundation the two of spades belongs on.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  pileSpecs,
  poseFoundation,
  poseWaste,
  type Harness,
} from "../harness";

/** The foundation the Ace of spades starts. Any slot may hold any suit. */
const FOUNDATION = 0;
/** The card that starts it, so the foundation's top card is the Ace of spades. */
const FOUNDATION_TOP = "AS";
/** The waste's one card: one rank above that top, and of its suit. */
const WASTE_TOP = "2S";
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
  poseFoundation(h, FOUNDATION, "spades", 1);
  poseWaste(h, [WASTE_TOP], WASTE_SETS);

  const went = h.debug.autoMove("waste", 0);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "home");

  assertEqual(
    went,
    true,
    `autoMove("waste", 0) with ${WASTE_TOP} on the waste and ${FOUNDATION_TOP} ` +
      "home, which is a legal auto-move (specs/instrumentation.md)",
  );
  assertDeepEqual(
    pileSpecs(after.foundations[FOUNDATION]),
    [FOUNDATION_TOP, WASTE_TOP],
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
