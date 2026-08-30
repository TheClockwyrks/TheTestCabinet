// presentation/empty-slot-drawn — an empty pile draws a slot at its anchor.
//
// THE RULE. specs/table.md, "Empty piles": "A pile holding no cards draws a
// card-sized mark at its anchor, `CARD_W x CARD_H`, so an empty slot reads apart
// from the bare table." specs/overview.md's legibility table says the same from
// the player's side: "A pile holding no cards reads as an empty slot at its
// anchor, apart from the bare table." A player who cannot see where an emptied
// column is cannot see where a King may go.
//
// WHAT IT DECIDES, AND WHAT IT LEAVES ALONE. That the mark is DRAWN, at every one
// of the thirteen anchors. Whether it reads apart from the felt is
// `presentation/slot-distinct-from-table`, and where each anchor lies is the
// `table` group's (`table.column-anchors`, `table.foundation-anchors`,
// `table.stock-anchor`, `table.waste-anchor`).
//
// ALL THIRTEEN, BECAUSE THE RULE IS ABOUT A PILE and every one of the thirteen is
// a pile. A build that marks its columns and leaves its foundations bare has
// missed the requirement, and the failure names the pile it missed.
//
// THE WASTE IS INCLUDED AND IS EMPTY HERE. specs/table.md: "A waste whose set
// memory is empty shows no card, so it draws the empty-slot mark at its anchor
// whatever cards it still holds" — and `openTable` leaves it holding none, so
// this reads the plain case of an empty pile rather than the set memory's, which
// belongs to the `stock` group.
//
// THE WORLD IT POSES. `openTable` and nothing else: all thirteen piles empty,
// which is exactly and only what this point is about.

import { afterEach, beforeEach, it } from "vitest";
import { FOUNDATION_COUNT, TABLEAU_COLUMNS } from "../../src/constants";
import { assertTrue } from "../assert";
import {
  boxAt,
  captureStill,
  cardBoxes,
  createHarness,
  drawFrame,
  drawnBoxes,
  openTable,
  pileTopLeft,
  type Harness,
  type PileKind,
} from "../harness";

/** The thirteen piles specs/table.md puts on the table, in its own order. */
const PILES: readonly { pile: PileKind; index: number }[] = [
  { pile: "stock", index: 0 },
  { pile: "waste", index: 0 },
  ...Array.from({ length: FOUNDATION_COUNT }, (_, index) => ({
    pile: "foundation" as const,
    index,
  })),
  ...Array.from({ length: TABLEAU_COLUMNS }, (_, index) => ({
    pile: "tableau" as const,
    index,
  })),
];

/**
 * How far a drawn box's top-left may sit from an anchor and still be read as
 * being at it, in logical units.
 *
 * Not a position tolerance: the `table` group is what holds a build to each
 * anchor, and this is only room for the unit a build may lose insetting a stroke
 * or rounding a corner, which is what the harness's `CARD_BOX_TOLERANCE` is set
 * at. A mark that is somewhere else misses by tens of units.
 */
const AT_ANCHOR = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a card-sized mark at the anchor of every empty pile", async () => {
  openTable(h);
  const calls = await drawFrame(h);
  captureStill(h, "slot");

  const boxes = cardBoxes(drawnBoxes(h, calls));
  for (const { pile, index } of PILES) {
    const at = pileTopLeft(pile, index);
    assertTrue(
      boxAt(boxes, at.x, at.y, AT_ANCHOR) !== null,
      `a card-sized mark drawn at (${at.x}, ${at.y}), the anchor of the empty ` +
        `${pile} ${String(index)} (specs/table.md: a pile holding no cards ` +
        "draws a card-sized mark at its anchor) — the frame drew " +
        `${String(boxes.length)} card-sized shapes, at ` +
        `${boxes.map((box) => `(${box.x}, ${box.y})`).join(", ") || "nowhere"}`,
    );
  }
});
