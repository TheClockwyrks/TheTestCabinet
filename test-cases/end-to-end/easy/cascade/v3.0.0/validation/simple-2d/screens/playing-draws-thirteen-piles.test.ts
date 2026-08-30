// screens/playing-draws-thirteen-piles — the live table draws all thirteen piles.
//
// THE RULE. specs/screens.md's `playing` section: the live table "draws all
// thirteen piles at the anchors specs/table.md fixes". specs/table.md names them:
// the stock, the waste and the four foundations in the top row at `TOP_ROW_Y`
// (`24`), and the seven tableau columns beneath at `TABLEAU_Y` (`180`), each at
// its own `COLUMN_X`.
//
// ONE CARD ON EACH, so what the frame is read for is thirteen drawn piles rather
// than thirteen empty slots: `presentation/empty-slot-drawn` is the point that
// decides the mark an empty pile draws. The card on the waste is given a set of
// one, because a waste whose set memory is empty shows no card whatever it holds
// (specs/stock.md). The stock's card is face-down, which is what a card in the
// stock is (specs/deal.md); every card here is distinct, so no pile can be showing
// another's.
//
// WHAT IS READ. The card-sized boxes the frame drew, each mapped back into logical
// units through the transform the context held at the call ({@link drawnBoxes}), and
// one is required near each pile's anchor. THE ANCHOR IS USED FOR AIMING, NOT FOR
// GRADING: this point decides that a pile was drawn at all, and the `table` group's
// fourteen points decide the geometry to their own figures. Hence the deliberately
// coarse tolerance below, which is far looser than any of those points allows.
//
// WHAT THIS DOES NOT DECIDE. What is drawn ON a card — its rank, its suit, its
// back — which is the `presentation` group's, nor where a column's further cards
// fan to, which is `table/face-up-offset` and its neighbours.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import {
  boxAt,
  cardBoxes,
  captureStill,
  createHarness,
  drawFrame,
  drawnBoxes,
  openTable,
  pileTopLeft,
  posePile,
  poseWaste,
  type Harness,
  type PileKind,
} from "../harness";

/**
 * How far a drawn box may sit from a pile's anchor, and from the card footprint,
 * and still be read as that pile being drawn, in logical units.
 *
 * NOT a placement tolerance. specs/table.md pitches the piles `122` apart, a
 * `100`-wide card and a `22` gap, and states that "the gaps between the columns
 * carry no pile and nothing card-sized is drawn in them". So a card-sized box
 * within `10` units of an anchor belongs to that pile and can belong to no other,
 * which is the whole of what this point needs to attribute a drawn box to a pile.
 * Where a build must draw its cards EXACTLY is `table/column-anchors`,
 * `table/stock-anchor`, `table/waste-anchor` and `table/foundation-anchors`, whose
 * tolerances are their own and are far tighter than this.
 */
const NEAR_ANCHOR = 10;

/** The thirteen piles, and the card posed on each. */
const PILES: readonly {
  pile: PileKind;
  index: number;
  what: string;
  card: string;
}[] = [
  { pile: "stock", index: 0, what: "the stock", card: "#2S" },
  { pile: "waste", index: 0, what: "the waste", card: "3H" },
  { pile: "foundation", index: 0, what: "foundation 0", card: "AS" },
  { pile: "foundation", index: 1, what: "foundation 1", card: "AH" },
  { pile: "foundation", index: 2, what: "foundation 2", card: "AD" },
  { pile: "foundation", index: 3, what: "foundation 3", card: "AC" },
  { pile: "tableau", index: 0, what: "column 0", card: "KS" },
  { pile: "tableau", index: 1, what: "column 1", card: "KH" },
  { pile: "tableau", index: 2, what: "column 2", card: "KD" },
  { pile: "tableau", index: 3, what: "column 3", card: "KC" },
  { pile: "tableau", index: 4, what: "column 4", card: "QS" },
  { pile: "tableau", index: 5, what: "column 5", card: "QH" },
  { pile: "tableau", index: 6, what: "column 6", card: "QD" },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a card at each of the thirteen piles' anchors", async () => {
  openTable(h);
  for (const at of PILES) {
    if (at.pile === "waste") poseWaste(h, [at.card], [1]);
    else posePile(h, at.pile, at.index, [at.card]);
  }
  assertEqual(
    h.snapshot().screen,
    "playing",
    "posing: the game is in live play, where the table is drawn " +
      "(specs/screens.md)",
  );

  const calls = await drawFrame(h);
  captureStill(h, "table");

  const boxes = cardBoxes(drawnBoxes(h, calls), NEAR_ANCHOR);
  for (const at of PILES) {
    const anchor = pileTopLeft(at.pile, at.index);
    assertNotNull(
      boxAt(boxes, anchor.x, anchor.y, NEAR_ANCHOR),
      `a card-sized box drawn within ${NEAR_ANCHOR} units of ${at.what}'s ` +
        `anchor (${anchor.x}, ${anchor.y}), so the pile is drawn at all ` +
        "(specs/screens.md, specs/table.md)",
    );
  }
});
