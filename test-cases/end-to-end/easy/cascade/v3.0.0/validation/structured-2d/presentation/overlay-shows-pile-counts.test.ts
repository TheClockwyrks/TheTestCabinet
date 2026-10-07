// presentation/overlay-shows-pile-counts — the overlay reports the pile sizes.
//
// THE RULE. specs/instrumentation.md, "Diagnostics": the build registers "how
// many cards are in the stock, on the waste, and on each of the four
// foundations" and "how many cards are in each of the seven columns". Under this
// engine registering them is the whole of Cascade's part; the panel is the
// engine's.
//
// WHAT IT DECIDES, AND WHAT IT LEAVES ALONE. That those thirteen figures reach
// the panel. The screen and the deal mode are `overlay-shows-screen`, the drag
// is `overlay-shows-drag`, and the cascade is `overlay-shows-cascade`.
//
// EVERY POSED COUNT IS DIFFERENT FROM EVERY OTHER, and that is the whole design
// of the board below. Thirteen distinct figures mean each one the panel carries
// can have come from one pile and no other, so a build that reports the stock
// twice and the waste not at all fails, and a build that reports a total in
// place of the four foundations fails. Posing four foundations of one size, or
// seven columns of one size, would have let a single figure answer for all of
// them.
//
// A FIGURE IS MATCHED AS A WHOLE RUN OF DIGITS, never as a substring, so the `1`
// of `17` cannot answer for a column of one card, and `13` is not answered by a
// `1` beside a `3`. How a build NAMES each line is its own — specs/
// instrumentation.md fixes no spelling — so only the values are read.
//
// THE WORLD IT POSES. `openTable` empties all thirteen piles, and each is then
// filled to its own count one card at a time. The waste is posed with its set
// memory, as specs/stock.md requires of any waste holding cards.

import { afterEach, beforeEach, it } from "vitest";
import {
  ALL_SUITS,
  alternatingRun,
  captureStill,
  createHarness,
  fullDeck,
  KING,
  openTable,
  poseColumn,
  poseFoundation,
  poseStock,
  poseWaste,
  toggleOverlay,
  type Harness,
} from "../harness";
import { assertFigure, overlayLines } from "./overlay";

/** How many cards each pile is posed with. No two of the thirteen are equal. */
const STOCK = 17;
const WASTE = 5;
const FOUNDATIONS: readonly number[] = [2, 3, 4, 6];
const COLUMNS: readonly number[] = [7, 8, 9, 10, 11, 12, 13];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws every pile's card count on the overlay", async () => {
  openTable(h);
  poseStock(h, fullDeck().slice(0, STOCK));
  poseWaste(h, fullDeck().slice(0, WASTE), [WASTE]);
  FOUNDATIONS.forEach((count, index) => {
    poseFoundation(h, index, ALL_SUITS[index], count);
  });
  COLUMNS.forEach((count, index) => {
    poseColumn(h, index, alternatingRun(KING, count));
  });

  const before = await h.drawFrame();
  const after = await toggleOverlay(h);
  captureStill(h, "overlay");
  const lines = overlayLines(before, after);

  assertFigure(lines, STOCK, "the cards in the stock");
  assertFigure(lines, WASTE, "the cards on the waste");
  FOUNDATIONS.forEach((count, index) => {
    assertFigure(lines, count, `the cards on foundation ${String(index)}`);
  });
  COLUMNS.forEach((count, index) => {
    assertFigure(lines, count, `the cards in column ${String(index)}`);
  });
});
