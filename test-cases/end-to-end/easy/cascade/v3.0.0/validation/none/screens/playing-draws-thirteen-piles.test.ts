// screens/playing-draws-thirteen-piles — the live table draws all thirteen piles,
// each at the anchor the specification fixes for it.
//
// `specs/screens.md`, the `playing` screen: "The live table. It draws all
// thirteen piles at the anchors `specs/table.md` fixes". `specs/table.md` fixes
// those anchors: the stock at `(224, 24)`, the waste at `(346, 24)`, the four
// foundations at `(590 | 712 | 834 | 956, 24)`, and each column's first card at
// `(COLUMN_X[i], 180)`. A card's footprint is `CARD_W x CARD_H` (`100 x 140`)
// "wherever it sits".
//
// THE POSE PUTS ONE CARD ON EVERY PILE, which is what makes thirteen readings
// thirteen answers. A build that drew twelve piles and skipped one — the waste,
// say, or the last column — is missing exactly one card-sized shape, and the
// failure names which pile's anchor had nothing near it. Posing rather than
// dealing is deliberate: a deal's layout is `deal`'s to grade, and a dealt table
// leaves four foundations and the waste empty, so five of the thirteen readings
// would be of the empty-slot mark rather than of a pile the build was asked to
// draw. Every card posed here is face-up, so nothing rests on how a back is
// drawn, and the foundations take Aces so the board is one the rules allow.
//
// WHAT IT DOES NOT DECIDE. That each anchor is EXACTLY where the specification
// puts it — that is `table/stock-anchor`, `table/waste-anchor`,
// `table/foundation-anchors`, `table/column-anchors` and `table/tableau-anchor-y`,
// item by item, and each of them asserts the figure with no slack at all. This
// item asks only that a pile was drawn at each of the thirteen, and it allows a
// few units of slack so a build whose plate is inset or outset by a unit or two
// still counts as having drawn its pile there.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import { FOUNDATION_COUNT, TABLEAU_COLUMNS, type Suit } from "../constants";
import {
  card,
  cardFootprints,
  captureStill,
  createHarness,
  openTable,
  pileTopLeft,
  poseColumn,
  poseFoundation,
  poseStock,
  poseWaste,
  type Harness,
  type PileName,
} from "../harness";

/**
 * How far a shape's measured size may sit from `CARD_W x CARD_H` and still be
 * read as a card.
 *
 * `specs/table.md` fixes the footprint at exactly `100 x 140`, and
 * `table/card-size` is the item that holds a build to it with no slack. Here the
 * size is only how a card is RECOGNIZED, so two units admits a build whose plate
 * carries a border it counted in or out — far too little to turn any other shape
 * on this screen into a card, the nearest being the HUD's `180 x 36` plates.
 */
const SIZE_TOLERANCE = 2;

/**
 * How far the shape found for a pile may sit from that pile's anchor.
 *
 * The anchors are `122` apart horizontally and `156` apart vertically
 * (`specs/table.md`), so four units cannot let one pile answer for another; it
 * admits only a build that drew its pile a hair off the corner the specification
 * names, which is the `table` group's question rather than this one's.
 */
const ANCHOR_TOLERANCE = 4;

/** The suit each foundation is started with. Any suit may start any foundation. */
const FOUNDATION_SUITS: readonly Suit[] = [
  "spades",
  "hearts",
  "diamonds",
  "clubs",
];

/** The Ace, which is the one card a foundation may hold on its own. */
const ACE = 1;

/** One frame, so the canvas carries the table the assertions read. */
const SETTLE_FRAMES = 1;

/** The thirteen piles, each named as the failure message should name it. */
const PILES: readonly { name: string; pile: PileName; index: number }[] = [
  { name: "the stock", pile: "stock", index: 0 },
  { name: "the waste", pile: "waste", index: 0 },
  ...Array.from({ length: FOUNDATION_COUNT }, (_, i) => ({
    name: `foundation ${i}`,
    pile: "foundation" as PileName,
    index: i,
  })),
  ...Array.from({ length: TABLEAU_COLUMNS }, (_, i) => ({
    name: `column ${i}`,
    pile: "tableau" as PileName,
    index: i,
  })),
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a pile at each of the thirteen anchors", async () => {
  await openTable(h);
  await poseStock(h, [card("9C")]);
  await poseWaste(h, [card("7D")], [1]);
  for (let i = 0; i < FOUNDATION_COUNT; i += 1) {
    await poseFoundation(h, i, FOUNDATION_SUITS[i], ACE);
  }
  for (let i = 0; i < TABLEAU_COLUMNS; i += 1) {
    await poseColumn(h, i, [card("KS")]);
  }

  const calls = await h.frameCalls();
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "table");

  const drawn = cardFootprints(calls, SIZE_TOLERANCE);
  for (const { name, pile, index } of PILES) {
    const anchor = pileTopLeft(pile, index);
    const nearest = drawn.reduce(
      (best, at) =>
        Math.min(best, Math.hypot(at.x - anchor.x, at.y - anchor.y)),
      Number.POSITIVE_INFINITY,
    );
    assertLessThanOrEqual(
      nearest,
      ANCHOR_TOLERANCE,
      `how far the nearest card-sized shape sits from ${name}'s anchor (${anchor.x}, ${anchor.y}) (specs/screens.md, specs/table.md)`,
    );
  }
});
