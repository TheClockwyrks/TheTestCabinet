// draw-one/waste-shows-one — the waste shows one card, squared over the rest.
//
// THE RULE. specs/stock.md has each turn append one set holding exactly the
// cards that turn moved, and has the waste show the cards it holds from the
// newest set that still holds any; `wasteVisibleCount` is that set's count
// (specs/instrumentation.md). A Draw One turn moves `TURN_COUNT` (`1`) card, so
// after any number of turns the waste shows exactly one card. specs/table.md
// then places it: the card the waste shows is drawn with its top-left at the
// waste anchor, `(WASTE_X, TOP_ROW_Y)`, and "every other card the waste holds is
// squared away beneath it".
//
// SO THE POINT HAS TWO ENDS OF ONE FACT — what the waste shows — and reads both:
// the count the build reports, and the picture it draws. A build that reported
// one and fanned three would leave a player playing a different deal from the
// one the snapshot claims, and a build that reported three and drew one would
// leave a player unable to tell which card is playable.
//
// THE POSE IS NINE CARDS FOR THREE TURNS, so a build whose turn moves two or
// three cards still takes three real turns rather than emptying the stock and
// recycling (specs/stock.md); each wrong count then reads a different
// `wasteVisibleCount` and draws a different number of cards away from the
// anchor, so the failure names the deal the build implemented.
//
// WHAT IT DOES NOT DECIDE. Where the waste anchor is at all is
// `table/waste-anchor`; how many cards a turn moves is `draw-one/turn-count`;
// what the waste falls back to once its newest set is played off is
// `draw-one/set-falls-back`.
//
// THE FIGURE IS WRITTEN OUT RATHER THAN IMPORTED. `src/constants.ts` is supplied
// with the project and carries this figure already, but the figure IS this
// item's requirement, so reading it back out of the build's own module would
// decide the point against whatever the build says rather than against the
// specification: a build that edited the file it was told not to edit would
// report its own figure to a check sized by that same figure and pass. The
// literal is written here for the same reason `draw-three` writes its own, and
// for the reason the engineless suite keeps a `constants.ts` of its own. Checks
// that merely SIZE a scenario to the deal mode still read
// `snapshot().turnCount`.

import { afterEach, beforeEach, it } from "vitest";
import {
  CARD_H,
  CARD_W,
  FOUNDATION_X,
  TOP_ROW_Y,
  WASTE_X,
} from "../../src/constants";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  ACE,
  EIGHT,
  FIVE,
  FOUR,
  JACK,
  NINE,
  QUEEN,
  SEVEN,
  TWO,
  captureStill,
  card,
  createHarness,
  drawnShapes,
  openTable,
  poseStock,
  shapesAt,
  type Harness,
} from "../harness";

/** specs/stock.md: this variant's `TURN_COUNT`, the cards one turn moves. */
const TURN_COUNT = 1;

/** Turns taken before the waste is read, which the review item fixes at three. */
const TURNS = 3;

/**
 * The stock those turns are taken from, bottom card first.
 *
 * Nine cards, three per turn at the largest turn count a build could plausibly
 * have written, so three turns never reach an empty stock and never recycle.
 * Their suits and ranks decide nothing here; no card is played, and what is read
 * is a count and a set of positions.
 */
const STOCK = [
  card("clubs", TWO),
  card("diamonds", FIVE),
  card("hearts", NINE),
  card("spades", JACK),
  card("diamonds", SEVEN),
  card("spades", FOUR),
  card("clubs", QUEEN),
  card("hearts", EIGHT),
  card("diamonds", ACE),
];

/**
 * How far a drawn card's top-left may sit from the waste anchor and still count
 * as squared onto it.
 *
 * Two units of the stage, room for the stroke a build insets or the corner it
 * rounds and nothing more. specs/table.md draws every card the waste holds at
 * the one anchor, so an offset past that is a second card a player can see, and
 * the smallest fan a build could plausibly draw is a whole card width's fraction
 * rather than a rounding error.
 */
const SQUARED_TOLERANCE = 2;

/**
 * How far a painted box's size may sit from `CARD_W x CARD_H` and still be read
 * as a card.
 *
 * The same two units, and for the same reason: specs/table.md gives every card a
 * `100 x 140` footprint wherever it sits, so a box within two units of that in
 * both directions is a card and the pips and rank marks drawn on it are not.
 */
const CARD_SIZE_TOLERANCE = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("shows a single card at the waste anchor after three turns", async () => {
  openTable(h);
  poseStock(h, STOCK);
  for (let turn = 0; turn < TURNS; turn += 1) h.debug.turnStock();

  const calls = await h.drawFrame();
  captureStill(h, "waste");

  const snapshot = h.snapshot();
  assertEqual(
    snapshot.wasteVisibleCount,
    TURN_COUNT,
    `cards the waste shows after ${TURNS} turns: the newest set holds exactly ` +
      "what the last turn moved (specs/stock.md)",
  );

  // Every card-sized box the frame painted across the top row, between the waste
  // anchor and the first foundation. specs/table.md gives that stretch to the
  // waste alone: the column position at its right carries no pile, and nothing
  // card-sized is drawn there.
  const acrossTheWaste = drawnShapes(h, calls).filter(
    (shape) =>
      Math.abs(shape.w - CARD_W) <= CARD_SIZE_TOLERANCE &&
      Math.abs(shape.h - CARD_H) <= CARD_SIZE_TOLERANCE &&
      Math.abs(shape.y - TOP_ROW_Y) <= SQUARED_TOLERANCE &&
      shape.x >= WASTE_X - SQUARED_TOLERANCE &&
      shape.x < FOUNDATION_X[0] - SQUARED_TOLERANCE,
  );

  assertGreaterThan(
    shapesAt(acrossTheWaste, WASTE_X, TOP_ROW_Y, SQUARED_TOLERANCE).length,
    0,
    `cards drawn at the waste anchor (${WASTE_X}, ${TOP_ROW_Y}), which is ` +
      "where the card the waste shows sits (specs/table.md)",
  );
  assertDeepEqual(
    acrossTheWaste
      .filter((shape) => Math.abs(shape.x - WASTE_X) > SQUARED_TOLERANCE)
      .map((shape) => Math.round(shape.x)),
    [],
    "the left edges of the cards the waste drew away from its anchor: it " +
      "squares every card it holds onto that one anchor (specs/table.md)",
  );
});
