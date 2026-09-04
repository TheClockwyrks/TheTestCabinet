// draw-one/waste-shows-one — the waste shows one card, squared over the rest.
//
// THE RULE. specs/stock.md has each turn append one set holding exactly the cards
// that turn moved, and has the waste show the cards of the newest set that still
// holds any; `wasteVisibleCount` is that set's count (specs/instrumentation.md).
// A Draw One turn moves `TURN_COUNT` (`1`) card, so after any number of turns the
// waste shows exactly one card. specs/table.md then places it: the card the waste
// shows is drawn with its top-left at the waste anchor, `(WASTE_X, TOP_ROW_Y)`,
// and "every other card the waste holds is squared away beneath it".
//
// SO THE POINT HAS TWO ENDS OF ONE FACT — what the waste shows — and reads both:
// the count the build reports, and the picture it draws. A build that reported one
// and fanned three would leave a player playing a different deal from the one the
// snapshot claims, and a build that reported three and drew one would leave a
// player unable to tell which card is playable.
//
// THE POSE IS NINE CARDS FOR THREE TURNS, so a build whose turn moves two or three
// cards still takes three real turns rather than emptying the stock and recycling
// (specs/stock.md); each wrong count then reads a different `wasteVisibleCount`
// and draws a different number of cards away from the anchor, so the failure names
// the deal the build implemented.
//
// WHAT IT DOES NOT DECIDE. Where the waste anchor is at all is
// `table/waste-anchor`; how many cards a turn moves is `draw-one/turn-count`; what
// the waste falls back to once its newest set is played off is
// `draw-one/set-falls-back`.
//
// THE FIGURE IS WRITTEN OUT RATHER THAN IMPORTED. The build writes its own
// `src/constants.ts` — specs/overview.md asks it for "every figure this
// specification fixes" — and the figure IS this item's requirement, so reading
// it back out of that module would decide the point against whatever the build
// says rather than against the specification: a build that turned the wrong
// number and named it consistently would answer a check sized by its own
// mistake and pass. The literal is written here for the same reason
// `draw-three` writes its own, and for the reason every project in this case
// keeps a `constants.ts` of its own. Checks that merely SIZE a scenario to the
// deal mode still read `snapshot().turnCount`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { FOUNDATION_X, TOP_ROW_Y, WASTE_X } from "../constants";
import {
  boxAt,
  captureStill,
  CARD_BOX_TOLERANCE,
  cardBoxes,
  createHarness,
  drawFrame,
  drawnBoxes,
  openTable,
  poseStock,
  type Harness,
} from "../harness";
import { TURN_COUNT } from "./constants";

/** Turns taken before the waste is read, which the review item fixes at three. */
const TURNS = 3;

/**
 * The stock those turns are taken from, bottom card first.
 *
 * Nine cards, three per turn at the largest turn count a build could plausibly
 * have written, so three turns never reach an empty stock and never recycle.
 * Face-down, because that is how a deal leaves the stock (specs/deal.md).
 */
const STOCK = ["#2C", "#5D", "#9H", "#JS", "#7D", "#4S", "#QC", "#8H", "#AD"];

/**
 * How far a drawn card's top-left may sit from the waste anchor and still count as
 * squared onto it.
 *
 * `CARD_BOX_TOLERANCE`, the harness's own reading of a drawn card: two units, room
 * for the stroke a build insets or the corner it rounds and nothing more.
 * specs/table.md draws every card the waste holds at the one anchor, so an offset
 * past that is a second card a player can see.
 */
const SQUARED_TOLERANCE = CARD_BOX_TOLERANCE;

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

  const calls = await drawFrame(h);
  captureStill(h, "waste");

  const snapshot = h.snapshot();
  assertEqual(
    snapshot.wasteVisibleCount,
    TURN_COUNT,
    `cards the waste shows after ${TURNS} turns: the newest set holds exactly ` +
      "what the last turn moved (specs/stock.md)",
  );

  // Every card-sized box the frame drew across the top row, between the waste
  // anchor and the first foundation. specs/table.md gives that stretch to the
  // waste alone: the column position at its right carries no pile, and nothing
  // card-sized is drawn there.
  const acrossTheWaste = cardBoxes(drawnBoxes(h, calls)).filter(
    (box) =>
      Math.abs(box.y - TOP_ROW_Y) <= SQUARED_TOLERANCE &&
      box.x >= WASTE_X - SQUARED_TOLERANCE &&
      box.x < FOUNDATION_X[0] - SQUARED_TOLERANCE,
  );

  assertNotNull(
    boxAt(acrossTheWaste, WASTE_X, TOP_ROW_Y),
    `a card drawn at the waste anchor (${WASTE_X}, ${TOP_ROW_Y}), which is ` +
      "where the card the waste shows sits (specs/table.md)",
  );
  assertDeepEqual(
    acrossTheWaste
      .filter((box) => Math.abs(box.x - WASTE_X) > SQUARED_TOLERANCE)
      .map((box) => box.x),
    [],
    "the left edges of the cards the waste drew away from its anchor: it " +
      "squares every card it holds onto that one anchor (specs/table.md)",
  );
});
