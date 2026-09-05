// presentation/empty-slot-drawn — an empty pile draws a slot at its anchor.
//
// THE RULE. `specs/table.md`, "Empty piles": "A pile holding no cards draws a
// card-sized mark at its anchor, `CARD_W x CARD_H`, so an empty slot reads apart
// from the bare table." `specs/overview.md`'s legibility table says the same
// from the player's side: "A pile holding no cards reads as an empty slot at its
// anchor, apart from the bare table." A player who cannot see where an emptied
// column is cannot see where a King may go.
//
// WHAT IT DECIDES, AND WHAT IT LEAVES ALONE. That the mark is DRAWN, at every
// one of the thirteen anchors. How the mark is drawn — its colour against the felt,
// its weight, its form — is the reviewer's, and where each anchor lies is the
// `table` group's (`table.column-anchors`, `table.foundation-anchors`,
// `table.stock-anchor`, `table.waste-anchor`).
//
// ALL THIRTEEN, BECAUSE THE RULE IS ABOUT A PILE and every one of the thirteen
// is a pile. A build that marks its columns and leaves its foundations bare has
// missed the requirement, and the failure names the pile it missed.
//
// THE WASTE IS INCLUDED AND IS EMPTY HERE. `specs/table.md`: "A waste whose set
// memory is empty shows no card, so it draws the empty-slot mark at its anchor
// whatever cards it still holds" — and `openTable` leaves it holding none, so
// this reads the plain case of an empty pile rather than the set memory's, which
// belongs to the `stock` group.
//
// THE WORLD IT POSES. `openTable` and nothing else: all thirteen piles empty,
// which is exactly and only what this point is about.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import { FOUNDATION_COUNT, TABLEAU_COLUMNS } from "../constants";
import {
  captureStill,
  cardFootprints,
  createHarness,
  openTable,
  pileTopLeft,
  type Harness,
  type PileName,
} from "../harness";

/** The thirteen piles specs/table.md puts on the table, in its own order. */
const PILES: readonly { pile: PileName; index: number }[] = [
  { pile: "stock", index: 0 },
  { pile: "waste", index: 0 },
  ...Array.from({ length: FOUNDATION_COUNT }, (_, index) => ({
    pile: "foundation" as PileName,
    index,
  })),
  ...Array.from({ length: TABLEAU_COLUMNS }, (_, index) => ({
    pile: "tableau" as PileName,
    index,
  })),
];

/**
 * How far a drawn box may sit from an anchor, and how far its size may sit from
 * `CARD_W x CARD_H`, and still be read as the mark drawn there, in logical
 * units.
 *
 * Not a position or a size tolerance on the build: the `table` group is what
 * holds a build to each anchor and to `100 x 140`. This is only room for the
 * unit a build may lose insetting a stroke or rounding a corner. A mark that is
 * somewhere else misses by tens of units.
 */
const AT_ANCHOR = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws a card-sized mark at the anchor of every empty pile", async () => {
  await openTable(h);
  const calls = await h.frameCalls();
  await captureStill(h, "slot");

  const boxes = cardFootprints(calls, AT_ANCHOR);
  const drew =
    boxes.map((box) => `(${box.x}, ${box.y})`).join(", ") || "nowhere";
  for (const { pile, index } of PILES) {
    const at = pileTopLeft(pile, index);
    assertTrue(
      boxes.some(
        (box) =>
          Math.abs(box.x - at.x) <= AT_ANCHOR &&
          Math.abs(box.y - at.y) <= AT_ANCHOR,
      ),
      `a card-sized mark drawn at (${String(at.x)}, ${String(at.y)}), the ` +
        `anchor of the empty ${pile} ${String(index)} (specs/table.md: a pile ` +
        "holding no cards draws a card-sized mark at its anchor) — the frame " +
        `drew ${String(boxes.length)} card-sized shapes, at ${drew}`,
    );
  }
});
