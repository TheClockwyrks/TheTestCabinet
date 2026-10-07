// tableau/no-flip-when-face-up — a move leaving a face-up card lowest turns nothing.
//
// specs/tableau.md: a card is turned only when an accepted move leaves a column
// whose lowest card is FACE-DOWN. "A move that leaves a face-up card lowest turns
// nothing."
//
// THE POSE. The source column is a face-down two of clubs, then a face-up nine of
// spades, then the face-up eight of hearts lying lowest. Moving the eight away
// leaves the nine lowest, and the nine is already face-up, so no card on the table
// is entitled to turn. The face-down two is still in that column, one row up, so a
// build that turns a column's deepest face-down card whenever a move touches the
// column — rather than only when that card has been left LOWEST — turns it and fails
// here.
//
// WHAT IS COMPARED IS EVERY CARD ON THE TABLE, by id, before and after the move. The
// requirement is that the move changes no card's face, and a check that read only
// the source column would pass a build that turned a card somewhere else. A card
// keeps its id across a move (specs/instrumentation.md, Identity), so the moved card
// is compared where the move put it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  card,
  captureStill,
  createHarness,
  down,
  EIGHT,
  NINE,
  openTable,
  poseColumn,
  TWO,
  type Harness,
} from "../harness";
import { facesById } from "./board";

/** The column the move takes a card off. */
const SOURCE = 2;
/** Its face-down card, the face-up card above the one moved, and the card moved. */
const SOURCE_CARDS = [
  down(card("clubs", TWO)),
  card("spades", NINE),
  card("hearts", EIGHT),
];
const MOVED_TEXT = "8H";
const LEFT_LOWEST_TEXT = "9S";
/** The moved card's row in that column, counted from the bottom. */
const MOVED_ROW = SOURCE_CARDS.length - 1;

/** The column that accepts it: its lowest card is one rank higher and black. */
const TARGET = 5;
const TARGET_CARDS = [card("clubs", NINE)];
const TARGET_LOWEST_TEXT = "9C";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("changes no card's face when the move leaves a face-up card lowest", async () => {
  openTable(h);
  poseColumn(h, SOURCE, SOURCE_CARDS);
  poseColumn(h, TARGET, TARGET_CARDS);
  const before = facesById(h.snapshot());

  const accepted = h.debug.move(
    "tableau",
    SOURCE,
    MOVED_ROW,
    "tableau",
    TARGET,
  );
  const after = facesById(h.snapshot());
  await h.advance(1);
  captureStill(h, "unchanged");

  assertEqual(
    accepted,
    true,
    `move of ${MOVED_TEXT} onto column ${TARGET}, whose lowest card ` +
      `${TARGET_LOWEST_TEXT} is one rank higher and the other color ` +
      "(specs/tableau.md)",
  );
  assertDeepEqual(
    after,
    before,
    "every card on the table by its id, each written with a leading # when " +
      `it lies face-down: the move left ${LEFT_LOWEST_TEXT}, already ` +
      `face-up, lowest in column ${SOURCE}, so it turns nothing ` +
      "(specs/tableau.md)",
  );
});
