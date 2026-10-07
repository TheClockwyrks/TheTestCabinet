// draw-one/turn-count — a turn of the stock moves exactly one card.
//
// THE RULE. specs/stock.md fixes this build's `TURN_COUNT` at `1`, and states
// that a turn of a stock holding cards moves `TURN_COUNT` cards onto the waste,
// taken one at a time from the top of the stock. One turn therefore leaves the
// stock one card smaller and the waste one card larger: the two readings are the
// two ends of the same movement, and a build that dropped a card on the way
// between them has not turned the stock either.
//
// THE POSE SIZES ITSELF SO EVERY WRONG COUNT READS DIFFERENTLY. The stock is
// posed with five cards, comfortably more than any turn count a build could
// plausibly have implemented, so a build that moves two or three reads a
// different pair of numbers rather than emptying the stock and recycling
// (specs/stock.md), which would fail this point on the recycle rather than on
// the count. A build that moves none reads the pose back unchanged.
//
// THE CARDS ARE POSED FACE-DOWN, which is what a card in the stock is
// (specs/deal.md) and what `poseStock` deals. Whether the turn then turns them
// face-up is `stock/turned-cards-face-up`, which card of the stock is taken
// first is `stock/turn-order`, and the set the turn appends to the waste's
// memory is `stock/turn-starts-a-set`. None of the three is decided here.
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
import { assertLength } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  FIVE,
  JACK,
  NINE,
  openTable,
  poseStock,
  SEVEN,
  TWO,
  type Harness,
} from "../harness";
import { TURN_COUNT } from "./constants";

/**
 * The stock the turn is taken from, bottom card first.
 *
 * Five cards, so one turn of any count a build could have written leaves cards
 * behind and the reading is the count itself rather than a recycle. Their suits
 * and ranks decide nothing here; no card is played, and the two readings are
 * lengths.
 */
const STOCK = [
  card("clubs", TWO),
  card("diamonds", FIVE),
  card("hearts", NINE),
  card("spades", JACK),
  card("diamonds", SEVEN),
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves one card off the stock and onto the waste", async () => {
  openTable(h);
  poseStock(h, STOCK);

  h.debug.turnStock();
  const after = h.snapshot();

  await h.advance(1);
  captureStill(h, "turn");

  assertLength(
    after.stock,
    STOCK.length - TURN_COUNT,
    "cards left in the stock after one turn of a stock holding " +
      `${STOCK.length}, which loses TURN_COUNT of them (specs/stock.md)`,
  );
  assertLength(
    after.waste,
    TURN_COUNT,
    "cards the same turn put on the waste, which gains exactly what the " +
      "stock lost (specs/stock.md)",
  );
});
