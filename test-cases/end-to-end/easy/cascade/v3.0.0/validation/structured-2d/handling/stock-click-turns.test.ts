// handling/stock-click-turns — a click on the stock turns cards onto the waste.
//
// THE RULE. specs/controls.md: a release "Within `DRAG_THRESHOLD` (`5`) of the
// press point" is a click, and a click "turns the stock, as `specs/stock.md`
// states, when the press point lies in the stock's drop rectangle".
// specs/table.md fixes that rectangle as `CARD_W x CARD_H` at `(STOCK_X,
// TOP_ROW_Y)`. specs/stock.md: "A turn of a stock holding cards moves
// `TURN_COUNT` cards onto the waste."
//
// WHAT IS ASSERTED, AND WHERE THE FIGURE COMES FROM. `TURN_COUNT` differs between
// the two deal modes and this suite is common to both, so it cannot be spelled
// here — and it must not be read out of the build's own `src/constants` either,
// which the build writes: a build that turns two cards and writes `TURN_COUNT = 2`
// would be measured against its own mistake and pass. The count comes off
// `snapshot().turnCount`, the reading `draw-one/deal-mode-reported` and
// `draw-three/deal-mode-reported` separately pin to the figure their own
// `specs/stock.md` fixes, so one common suite is right under either deal mode and
// the figure behind it is still graded against the specification.
//
// THE STOCK HOLDS TWO MORE CARDS THAN A TURN TAKES, so the models separate:
//
//   one turn of TURN_COUNT cards (the rule)  ->  TURN_COUNT on the waste
//   the whole stock                          ->  TURN_COUNT + 2 on the waste
//   a turn on the press AND on the release   ->  2 * TURN_COUNT on the waste
//   nothing                                  ->  an empty waste
//
// AND THE STOCK IS READ AS WELL AS THE WASTE. A turn MOVES cards; it does not
// copy them. A build that appends to the waste and leaves the stock as it was
// gives a player a deck that never runs out and a game that cannot be lost, so
// both sides of the move are read off the one click: `SPARE` cards left behind,
// and `TURN_COUNT` arrived.
//
// THE CLICK IS AT ZERO DISTANCE, which is inside `DRAG_THRESHOLD` by any reading;
// `handling/drag-threshold` is the point that decides where the threshold lies.
// The press lands on the centre of the stock's own drop rectangle, so nothing
// here depends on where within it a build answers.
//
// WHAT A TURN MOVES AND IN WHICH ORDER is the `stock` group's; this point decides
// only that the gesture reaches the turn at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLength } from "../assert";
import {
  captureStill,
  card,
  clickAt,
  createHarness,
  dropRectIn,
  openTable,
  poseStock,
  rectCenter,
  type CardSpec,
  type Harness,
} from "../harness";

/** How many cards are left in the stock after one turn takes its share. */
const SPARE = 2;

/**
 * The stock, bottom card first, so the last is the one the next turn takes. The
 * cards are distinct; their suit and rank decide nothing here.
 */
function stockOf(turnCount: number): CardSpec[] {
  return Array.from({ length: turnCount + SPARE }, (_, i) =>
    card("hearts", i + 1),
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("grows the waste by the turn count when a press and release land on the stock", async () => {
  openTable(h);

  const turnCount = h.snapshot().turnCount;
  assertGreaterThan(turnCount, 0, "the turn count this build reports");
  const cards = stockOf(turnCount);

  poseStock(h, cards);

  const at = rectCenter(dropRectIn(h.snapshot(), "stock"));
  clickAt(h, at.x, at.y);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "turned");

  assertLength(
    after.waste,
    turnCount,
    `the cards on the waste after one click on the stock, which turns this ` +
      `build's TURN_COUNT of them off a stock holding ` +
      `${String(cards.length)} (specs/controls.md, specs/stock.md)`,
  );
  assertLength(
    after.stock,
    SPARE,
    `the cards left on the stock after that click: the ` +
      `${String(cards.length)} it held less the TURN_COUNT the turn moved — a ` +
      "turn moves its cards onto the waste rather than copying them " +
      "(specs/stock.md)",
  );
});
