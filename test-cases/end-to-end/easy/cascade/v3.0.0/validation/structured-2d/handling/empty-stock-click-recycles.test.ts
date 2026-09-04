// handling/empty-stock-click-recycles — a click on the empty stock slot recycles
// the waste.
//
// THE RULE. specs/controls.md: a click "turns the stock ... when the press point
// lies in the stock's drop rectangle". specs/stock.md: "A turn of an empty stock
// recycles instead: every card on the waste returns to the stock face-down, in
// reverse order ... The waste is left empty and its set memory is emptied with
// it." specs/table.md fixes the stock's rectangle as `CARD_W x CARD_H` at
// `(STOCK_X, TOP_ROW_Y)` whether it holds cards or not, and specs/table.md has an
// empty pile draw "a card-sized mark at its anchor", so the slot is there to
// press even with nothing on it.
//
// WHAT IS READ. Every card the waste held is now in the stock, and the waste holds
// none. That the recycled order is reversed, and that the memory went with the
// cards, are `stock/recycle-preserves-order` and `stock/recycle-clears-sets`; this
// point decides only that the GESTURE reaches the recycle.
//
// THE WASTE IS THREE TURNS DEEP, sized by `snapshot().turnCount` — not by the
// build's own `src/constants`, which the build writes — so the pose is the waste
// three turns of this build's stock leave (specs/stock.md) and the same sentence
// holds under either deal mode. The reading itself is pinned to the specification
// by `draw-one/deal-mode-reported` and `draw-three/deal-mode-reported`. A build
// that moved one turn's worth back rather than the whole waste, or that turned
// rather than recycled, reads as a different pair of counts.
//
// THE CLICK IS AT ZERO DISTANCE from its press, inside `DRAG_THRESHOLD` by any
// reading; `handling/drag-threshold` is the point that decides the threshold.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLength } from "../assert";
import {
  captureStill,
  card,
  clickAt,
  createHarness,
  dropRectIn,
  openTable,
  poseWaste,
  rectCenter,
  type CardSpec,
  type Harness,
} from "../harness";

/** How many turns' worth of cards the waste holds. */
const TURNS = 3;

/** The cards on the waste, bottom first. Their suit and rank decide nothing. */
function wasteOf(turnCount: number): CardSpec[] {
  return Array.from({ length: TURNS * turnCount }, (_, i) =>
    card("clubs", i + 1),
  );
}

/** The set memory those cards belong to: one set per turn (specs/stock.md). */
function setsOf(turnCount: number): number[] {
  return Array.from({ length: TURNS }, () => turnCount);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns the whole waste to the stock when a click lands on the empty stock slot", async () => {
  // `openTable` clears all thirteen piles, so the stock is empty before the
  // waste is posed and the click meets an empty stock.
  openTable(h);

  const turnCount = h.snapshot().turnCount;
  assertGreaterThan(turnCount, 0, "the turn count this build reports");
  const cards = wasteOf(turnCount);

  poseWaste(h, cards, setsOf(turnCount));

  const at = rectCenter(dropRectIn(h.snapshot(), "stock"));
  clickAt(h, at.x, at.y);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "recycled");

  assertLength(
    after.stock,
    cards.length,
    "the cards in the stock after a click on the empty stock slot, which " +
      `recycles the whole ${String(cards.length)}-card waste into it ` +
      "(specs/controls.md, specs/stock.md)",
  );
  assertLength(
    after.waste,
    0,
    "the cards left on the waste after the recycle, which leaves it empty " +
      "(specs/stock.md)",
  );
});
