// stock/play-exposes-next — the card under the one that left is the new top card.
//
// THE RULE. specs/stock.md: "Once the top card has left, the card beneath it is the
// waste's top card." The waste is a stack held bottom to top
// (specs/instrumentation.md), so a card leaving it uncovers exactly the card that
// lay under it, and that card is the one the player may play next. A build that
// dropped the wrong card, or that left the departed card's place standing, would
// offer the player a card that is not there.
//
// THE WASTE IS POSED THREE DEEP, so there is a card under the one that leaves and a
// card under THAT, and a build that emptied the waste, or that uncovered the bottom
// card instead of the next one, is caught by which id comes up rather than by a
// count. Cards are followed by id, which a card keeps for as long as it is on the
// table (specs/instrumentation.md).
//
// THE UNCOVERED CARD IS STILL SHOWN. The set it belongs to holds two cards before
// the play and one after, so the waste falls back to nothing and the card that comes
// up is a card the player can see and reach. Whether the SET shrank is
// `stock/set-shrinks-on-play`; what happens when a set is played off entirely is the
// two variants' `set-falls-back`.
//
// THE PLAY IS AN ACE ONTO AN EMPTY FOUNDATION, the one move that needs nothing built
// first (specs/foundations.md), and its acceptance is asserted first: a refused move
// takes nothing off the waste and there would be no card to expose.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  poseWaste,
  topOf,
  type Harness,
} from "../harness";

/**
 * The waste the play comes off: three cards, an older set of one under a newer set
 * of two, the Ace of spades on top and the nine of diamonds directly beneath it.
 */
const POSED_WASTE = ["2C", "9D", "AS"] as const;
const POSED_SETS = [1, 2] as const;

/** The row the Ace sits at, and the row of the card it covers. */
const ACE_ROW = POSED_WASTE.length - 1;
const BENEATH_ROW = ACE_ROW - 1;

/** The foundation the Ace goes home to: empty, so it accepts an Ace of any suit. */
const FOUNDATION = 0;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("makes the card beneath the departing top card the waste's top card", async () => {
  openTable(harness);
  const ids = poseWaste(harness, POSED_WASTE, POSED_SETS);
  const beneath = ids[BENEATH_ROW];

  const accepted = harness.debug.move(
    "waste",
    0,
    ACE_ROW,
    "foundation",
    FOUNDATION,
  );

  await harness.advance(1);
  captureStill(harness, "exposed");

  assertEqual(
    accepted,
    true,
    "move() to accept the waste's Ace onto an empty foundation, which is the " +
      "departure that exposes the card beneath it (specs/foundations.md)",
  );

  const after = harness.snapshot();
  assertEqual(
    topOf(after, "waste")?.id,
    beneath,
    "the id of the waste's top card once the card above it has been played " +
      "(specs/stock.md)",
  );
});
