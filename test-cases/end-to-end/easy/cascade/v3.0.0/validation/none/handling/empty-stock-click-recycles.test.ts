// handling/empty-stock-click-recycles — a click on the empty stock slot recycles
// the waste back into the stock.
//
// `specs/controls.md` fixes the gesture: a click "turns the stock, as
// `specs/stock.md` states, when the press point lies in the stock's drop
// rectangle". `specs/stock.md` fixes what a turn of an empty stock does: "A turn
// of an empty stock recycles instead: every card on the waste returns to the
// stock face-down, in reverse order ... The waste is left empty and its set
// memory is emptied with it."
//
// `specs/table.md` fixes the rectangle the click has to land in: "The stock |
// `CARD_W x CARD_H` at `(STOCK_X, TOP_ROW_Y)`", which is the empty-slot mark the
// player sees once the stock has run out. So this decides that an EMPTY stock
// still answers the pointer — a build that hit-tests its cards rather than its
// slot answers nothing here and leaves the game unplayable past the first pass.
//
// WHAT THIS DECIDES, AND WHAT DECIDES IT ELSEWHERE. The subject is the gesture
// and the fact that the cards come back. The order they come back in, the faces
// they come back with, and the emptying of the set memory are the `stock` group's,
// driven through `turnStock()`.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import {
  cardCenter,
  cards,
  captureStill,
  clickAt,
  createHarness,
  openTable,
  pileTopLeft,
  poseWaste,
  type Harness,
} from "../harness";

/** The waste, bottom card first, and the sets those cards were turned as. */
const WASTE = ["2C", "5H", "9S"] as const;
const WASTE_SETS = [1, 1, 1];

/** One frame, so the canvas carries the board the assertions read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns the waste to the stock when the empty stock slot is clicked", async () => {
  await openTable(h);
  await poseWaste(h, cards(...WASTE), WASTE_SETS);

  const posed = await h.snapshot();
  assertLength(posed.stock, 0, "the stock before the click");

  const anchor = pileTopLeft("stock");
  const press = cardCenter(anchor.x, anchor.y);
  await clickAt(h, press.x, press.y);
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "recycled");

  const after = await h.snapshot();
  assertLength(
    after.stock,
    WASTE.length,
    "the cards the click returned to the stock",
  );
  assertLength(after.waste, 0, "the cards left on the waste");
});
