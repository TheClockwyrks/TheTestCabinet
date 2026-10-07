// foundations/accepts-from-waste — the waste is a source a foundation takes
// from.
//
// `specs/foundations.md`: "A foundation accepts a card from a tableau column and
// from the waste, on exactly the terms above." This check decides the waste half
// of that sentence: the same acceptance rule `build-up-same-suit` decides for a
// column has to hold when the card comes off the waste instead, and the card has
// to LEAVE the waste rather than be copied onto the foundation.
//
// THE WASTE IS POSED WITH ONE CARD ON ONE SET, which is the smallest waste that
// shows anything. `specs/stock.md` makes the waste's shown cards the ones on the
// newest set, and its top card the only one that may be played, so a waste of
// one card on a set of one has exactly one playable card and no set bookkeeping
// can decide the outcome instead of the acceptance rule. The set count is given
// explicitly rather than reached by turning the stock, because a turn moves the
// deal mode's turn count and this check is common to both variants
// (`draw-one/*` and `draw-three/*` are where a turn count is asserted).
//
// THE READING IS BOTH PILES. The two of spades on the foundation and a waste
// holding nothing is the pass. A build that refused reads an empty foundation
// slot above the Ace and the two still on the waste. A build that landed the
// card without taking it off its source reads it in both places, which
// `whereIs` cannot report and the waste's length catches.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { RANK_MIN } from "../constants";
import {
  captureStill,
  cards,
  createHarness,
  openTable,
  pileOf,
  poseFoundation,
  poseWaste,
  whereIs,
  type Harness,
} from "../harness";

/** The foundation under test, and the suit its Ace locks it to. */
const FOUNDATION = 0;
const SUIT = "spades" as const;

/** The waste: one card, on one set, so it is the shown card and the top card. */
const WASTE = cards("2S");
const WASTE_SETS = [1];

/** Where that card sits in the waste, counted from the bottom. */
const WASTE_ROW = 0;

/** One frame, so the still shows the waste's card on its foundation. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("takes the waste's top card onto a legal foundation and empties the waste", async () => {
  await openTable(h);
  await poseFoundation(h, FOUNDATION, SUIT, RANK_MIN);
  const [wasteId] = await poseWaste(h, WASTE, WASTE_SETS);

  const accepted = await h.debug.move(
    "waste",
    0,
    WASTE_ROW,
    "foundation",
    FOUNDATION,
  );

  await h.advance(DRAW_FRAMES);
  await captureStill(h, "accepted");
  const after = await h.snapshot();

  assertEqual(
    accepted,
    true,
    `move's verdict on the waste's ${SUIT} 2 offered to a ${SUIT} foundation ` +
      "holding its Ace — specs/foundations.md: a foundation accepts a card " +
      "from the waste on exactly the terms it accepts one from a column",
  );
  assertDeepEqual(
    whereIs(after, wasteId),
    { pile: "foundation", index: FOUNDATION, row: 1 },
    `where the ${SUIT} 2 (id ${wasteId}) sits after the move — it is the ` +
      "foundation's new top card. A reading naming the waste is a build that " +
      "refused the move",
  );
  assertLength(
    pileOf(after, "foundation", FOUNDATION),
    2,
    `the cards on foundation ${FOUNDATION} after the move`,
  );
  assertLength(
    pileOf(after, "waste", 0),
    0,
    "the cards left on the waste — the card went home, so it left the waste " +
      "rather than being copied off it",
  );
});
