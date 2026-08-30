// screens/playing-draws-thirteen-piles — the live table draws every pile.
//
// specs/screens.md: the `playing` screen "draws all thirteen piles at the anchors
// `specs/table.md` fixes". specs/table.md is where those anchors are: the stock at
// `(224, 24)`, the waste at `(346, 24)`, the four foundations at
// `(FOUNDATION_X[i], 24)`, and each column's first card at `(COLUMN_X[i], 180)`.
// A player who cannot see one of the thirteen cannot play the game with it.
//
// ONE CARD ON EACH PILE, AND NOTHING ELSE ON THE TABLE. The requirement is that
// every pile is drawn, so the world is posed with exactly thirteen cards, one per
// pile, each of them therefore that pile's top card and drawn at its pile's
// anchor. The waste is posed with its set, because a waste whose set memory is
// empty shows no card whatever it holds (specs/stock.md). Reading a DEALT board
// instead would decide this point on the deal's own correctness, which is the
// `deal` group's, and would leave four foundations empty.
//
// TWO READINGS, ONE PER PILE, AND A PILE OWES BOTH.
//
//   A CARD-SIZED BOX AT THE ANCHOR. A card occupies `CARD_W x CARD_H` at its
//   top-left wherever it sits (specs/table.md), but the CALL a build draws it
//   with is the build's own: a `fillRect`, a hand-built rounded path, or a
//   blitted bitmap are the same card to a player, so the frame's painted shapes
//   and its blits are both looked through and mapped back to logical units.
//
//   THE PICTURE THERE CHANGED. A box alone cannot tell a drawn card from the
//   card-sized mark an EMPTY pile draws at the same anchor (specs/table.md), so
//   the same rectangle is read on the bare table posed first and on the table
//   holding its thirteen cards, and the two must differ. A build that goes on
//   drawing an empty slot where a card sits — the failure this reading exists
//   for — leaves the two identical.
//
// The comparison is against THIS BUILD's own bare table, so nothing here knows
// what a card or a slot is supposed to look like: it knows only that a pile
// holding a card has to look different from the same pile holding none.
//
// WHAT THIS DOES NOT DECIDE. That an EMPTY pile draws its slot is
// `presentation/empty-slot-drawn`; that a card face carries its rank and suit is
// `presentation/rank-drawn` and `presentation/suit-drawn`; that each anchor is
// the right one to a unit, and that nothing card-sized is drawn between the
// piles, are the `table` group's. This point asks the one question none of those
// asks: are all thirteen there at once.

import { afterEach, beforeEach, it } from "vitest";
import { CARD_H, CARD_W } from "../../src/constants";
import { assertEqual, assertGreaterThanOrEqual, assertTrue } from "../assert";
import {
  ACE,
  ALL_SUITS,
  card,
  captureStill,
  COLUMNS,
  createHarness,
  drawnImages,
  drawnShapes,
  everyCard,
  FOUNDATIONS,
  openTable,
  pileTopLeft,
  poseCard,
  poseColumn,
  poseStock,
  poseWaste,
  regionPixels,
  type CardSpec,
  type Harness,
  type PileKind,
} from "../harness";

/**
 * How far a drawn box's size and corner may sit from the figures specs/table.md
 * fixes, in logical units.
 *
 * A card's footprint is exactly `CARD_W x CARD_H` at its anchor, so this is not a
 * size tolerance: it is room for the unit a build may lose insetting a stroke or
 * rounding a corner. Anything that is not a card at that anchor misses by tens of
 * units.
 */
const CARD_BOX_TOLERANCE = 2;

/**
 * How many pixels of a pile's card rectangle must change when the pile goes from
 * holding nothing to holding a card.
 *
 * A card's footprint is `100 x 140`, which is fourteen thousand pixels, and a
 * face-up card owes a rank and a suit drawn on it over a body that reads apart
 * from the table (specs/overview.md), so a real card changes a large fraction of
 * them. One percent of the footprint is far below the smallest of those marks and
 * far above the handful of pixels an anti-aliased edge can shift.
 */
const MIN_CHANGED_PIXELS = Math.round((CARD_W * CARD_H) / 100);

/** One card for each of the thirteen piles, all of them distinct. */
const ON_STOCK: CardSpec = card("clubs", 2);
const ON_WASTE: CardSpec = card("hearts", 3);
const ON_COLUMNS: readonly CardSpec[] = [
  card("spades", 4),
  card("hearts", 5),
  card("clubs", 6),
  card("diamonds", 7),
  card("spades", 8),
  card("hearts", 9),
  card("clubs", 10),
];

/** Every one of the thirteen piles, as the pair that names its anchor. */
const PILES: readonly { pile: PileKind; index: number }[] = [
  { pile: "stock", index: 0 },
  { pile: "waste", index: 0 },
  ...FOUNDATIONS.map((index) => ({ pile: "foundation" as PileKind, index })),
  ...COLUMNS.map((index) => ({ pile: "tableau" as PileKind, index })),
];

/** How many pixels of two readings of the same rectangle differ. */
function differingPixels(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
): number {
  let differing = 0;
  for (let i = 0; i + 3 < before.length && i + 3 < after.length; i += 4) {
    if (
      before[i] !== after[i] ||
      before[i + 1] !== after[i + 1] ||
      before[i + 2] !== after[i + 2] ||
      before[i + 3] !== after[i + 3]
    ) {
      differing += 1;
    }
  }
  return differing;
}

/** Every pile's card rectangle, read off the canvas as it stands. */
function pileRegions(h: Harness): Uint8ClampedArray[] {
  return PILES.map(({ pile, index }) => {
    const anchor = pileTopLeft(pile, index);
    return regionPixels(h, { x: anchor.x, y: anchor.y, w: CARD_W, h: CARD_H });
  });
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a card at every one of the thirteen piles' anchors", async () => {
  openTable(h);
  assertEqual(
    h.snapshot().screen,
    "playing",
    "posing: the live table, which is the screen the thirteen piles are drawn " +
      "on (specs/screens.md)",
  );

  // The bare table, which every pile is read against below.
  await h.drawFrame();
  const bare = pileRegions(h);

  poseStock(h, [ON_STOCK]);
  // The waste's one card with the set that shows it (specs/stock.md).
  poseWaste(h, [ON_WASTE], [1]);
  for (const index of FOUNDATIONS) {
    poseCard(h, "foundation", index, card(ALL_SUITS[index], ACE));
  }
  for (const index of COLUMNS) poseColumn(h, index, [ON_COLUMNS[index]]);

  assertEqual(
    everyCard(h.snapshot()).length,
    PILES.length,
    "posing: cards on the table, one for each of the thirteen piles " +
      "(specs/table.md)",
  );

  const calls = await h.drawFrame();
  const held = pileRegions(h);
  captureStill(h, "table");

  // Every card-sized box the frame painted or blitted, in logical units.
  const boxes = [...drawnShapes(h, calls), ...drawnImages(h, calls)].filter(
    (box) =>
      Math.abs(box.w - CARD_W) <= CARD_BOX_TOLERANCE &&
      Math.abs(box.h - CARD_H) <= CARD_BOX_TOLERANCE,
  );

  PILES.forEach(({ pile, index }, at) => {
    const anchor = pileTopLeft(pile, index);
    assertTrue(
      boxes.some(
        (box) =>
          Math.abs(box.x - anchor.x) <= CARD_BOX_TOLERANCE &&
          Math.abs(box.y - anchor.y) <= CARD_BOX_TOLERANCE,
      ),
      `a card-sized shape drawn at the ${pile} ${index} anchor (${anchor.x}, ` +
        `${anchor.y}), where the table holds one card (specs/screens.md, ` +
        "specs/table.md)",
    );
    assertGreaterThanOrEqual(
      differingPixels(bare[at], held[at]),
      MIN_CHANGED_PIXELS,
      `pixels of the ${pile} ${index} anchor that changed when the pile took ` +
        "its card, so what is drawn there is the card and not the empty " +
        "slot (specs/screens.md, specs/table.md)",
    );
  });
});
