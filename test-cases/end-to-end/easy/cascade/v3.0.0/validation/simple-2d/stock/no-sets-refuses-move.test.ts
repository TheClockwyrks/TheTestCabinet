// stock/no-sets-refuses-move — a waste whose set memory is empty offers no card to
// play, and a move naming one is refused.
//
// THE RULE. specs/stock.md, The waste's set memory: "A waste whose set memory is
// empty shows no card and offers none to play, whatever cards it still holds, and a
// move naming a waste card is refused."
//
// WHY THE STATE IS REACHABLE, AND WHY IT NEEDS A POINT. Under Draw Three a player
// reaches it by turning three, playing one, turning three and playing all three:
// the newest set empties, the fallback set was already played off, and the waste
// owes cards nothing remembers. `clearWasteSets()` reaches the same state in one
// call (specs/instrumentation.md: it "empties the waste's set memory, leaving the
// cards on the waste standing"), which is how this point poses it under either deal
// mode.
//
// THE TARGET WOULD TAKE THE CARD IF THE WASTE OFFERED IT, which is what makes the
// refusal decide THIS rule rather than the column's. The waste's last card is the
// red Jack, and column 6 shows the black Queen: one rank higher and the opposite
// colour, which specs/tableau.md has a column accept. So a build that played off a
// waste with no memory reads as an ACCEPTED move here, and the fault is named where
// it belongs.
//
// THE ROW NAMED IS THE WASTE'S LAST CARD, the one a waste with a memory would be
// showing. `stock/only-top-playable` decides a move naming a card BELOW the top of a
// waste that does show one, which is a different rule about a different board: this
// point's waste shows nothing at all, so its last card is refused too.
//
// EVERY OTHER READING IS THE BOARD BEING UNCHANGED. specs/tableau.md: "A refused
// move changes nothing." The waste keeps all three cards in their order, its set
// memory is still empty, and the column still holds its Queen alone.
//
// WHAT IT DOES NOT DECIDE. What such a waste DRAWS is `stock/no-sets-shows-nothing`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  poseWaste,
  type Harness,
} from "../harness";

/** The column the refused move names, showing a card the Jack would fit onto. */
const COLUMN = 6;
const COLUMN_CARDS = ["QS"] as const;

/** The waste, bottom card first. Its last card is the one the move names. */
const WASTE = ["2C", "3D", "JH"] as const;

/** The row the move names: the waste's last card. */
const NAMED_ROW = WASTE.length - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a move naming a card on a waste with no sets", async () => {
  openTable(h);
  const columnIds = poseColumn(h, COLUMN, [...COLUMN_CARDS]);
  const wasteIds = poseWaste(h, [...WASTE], []);

  const accepted = h.debug.move("waste", 0, NAMED_ROW, "tableau", COLUMN);

  await h.advance(1);
  captureStill(h, "refused");

  assertEqual(
    accepted,
    false,
    `move()'s verdict on the ${WASTE[NAMED_ROW]}, the last card of a waste ` +
      "whose set memory is empty (specs/stock.md: such a waste offers no card " +
      "to play, whatever cards it still holds, and a move naming a waste card " +
      `is refused). Column ${COLUMN} shows the ${COLUMN_CARDS[0]} and would ` +
      "accept that card from a pile that offered it, so a verdict of true is " +
      "the waste's rule broken rather than the column's",
  );

  const after = h.snapshot();
  assertDeepEqual(
    after.waste.map((card) => card.id),
    wasteIds,
    "the ids on the waste, bottom first, after the refused move, which " +
      "changes nothing (specs/tableau.md)",
  );
  assertLength(
    after.wasteSets,
    0,
    "the sets in the waste's memory after the refused move: it was posed " +
      "empty and a move that never happened adds nothing to it " +
      "(specs/stock.md)",
  );
  assertDeepEqual(
    pileOf(after, "tableau", COLUMN).map((card) => card.id),
    columnIds,
    `the ids in column ${COLUMN} after the refused move: the target keeps ` +
      "what it held (specs/tableau.md)",
  );
});
