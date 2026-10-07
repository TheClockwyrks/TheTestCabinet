// handling/stock-click-turns — a press and a release on the stock turns cards
// onto the waste.
//
// `specs/controls.md` fixes the gesture: a release "Within `DRAG_THRESHOLD` (`5`)
// of the press point" is a click, and a click "turns the stock, as
// `specs/stock.md` states, when the press point lies in the stock's drop
// rectangle". `specs/stock.md` fixes how many: "A turn of a stock holding cards
// moves `TURN_COUNT` cards onto the waste".
//
// WHY THE TURN COUNT IS READ RATHER THAN WRITTEN. `TURN_COUNT` is one of the four
// figures that differ between the two deal modes, so a common check never
// hard-codes it: the expected growth is `snapshot().turnCount`, which
// `draw-one/deal-mode-reported` and `draw-three/deal-mode-reported` separately
// pin to the figure their own `specs/stock.md` fixes.
//
// WHAT THIS DECIDES, AND WHAT DECIDES IT ELSEWHERE. The subject is the GESTURE.
// Which cards a turn moves, in what order, and what it does to the waste's set
// memory are the `stock` group's, driven through `turnStock()`; a build whose
// `turnStock()` is right but whose stock does not answer a click fails here and
// nowhere else.
//
// The stock is posed with more cards than either deal mode's turn takes, so a
// turn is never a remainder turn and the growth really is the turn count.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import {
  cardCenter,
  cards,
  captureStill,
  clickAt,
  createHarness,
  openTable,
  pileTopLeft,
  poseStock,
  type Harness,
} from "../harness";

/** The stock, bottom card first. More than any deal mode's turn takes. */
const STOCK = ["2C", "5H", "9S", "JD", "4C", "7H"] as const;

/** One frame, so the canvas carries the board the assertions read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("turns the deal mode's turn count of cards when the stock is clicked", async () => {
  await openTable(h);
  await poseStock(h, cards(...STOCK));

  const posed = await h.snapshot();
  const turnCount = posed.turnCount;
  assertGreaterThan(turnCount, 0, "the turn count this build reports");
  assertLength(posed.waste, 0, "the waste before the click");

  const anchor = pileTopLeft("stock");
  const press = cardCenter(anchor.x, anchor.y);
  await clickAt(h, press.x, press.y);
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "turned");

  const after = await h.snapshot();
  assertLength(after.waste, turnCount, "the cards the click put on the waste");
  assertEqual(
    after.stock.length,
    STOCK.length - turnCount,
    "the cards the click left on the stock",
  );
});
