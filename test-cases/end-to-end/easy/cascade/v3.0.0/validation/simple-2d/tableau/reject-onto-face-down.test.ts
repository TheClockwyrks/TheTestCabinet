// tableau/reject-onto-face-down — a column whose lowest card is face-down takes
// nothing.
//
// specs/tableau.md fixes it as a row of its own: a column whose lowest card is
// face-down accepts "Nothing". The same file says why: "a face-down card is never
// moved and is never read", so its rank and color decide nothing and the column is
// not empty either.
// specs/instrumentation.md: a refused `move` returns `false` and leaves the board
// unchanged.
//
// THE COLUMN IS TWO FACE-DOWN CARDS, which is how a column reaches this state in
// play: the cards a deal buried, with none of them turned yet.
//
// THE TWO CARDS ARE THE TWO WRONG MODELS. The KING is the card an EMPTY column takes,
// so a build that reads "no face-up card" as "empty" accepts it. The BLACK EIGHT is
// the card the rule would take if the buried lowest card, the red nine, were face-up,
// so a build that READS the face-down card accepts that one. Each is refused for its
// own reason and each is read in a failure of its own; a build that refuses both
// cannot be doing either wrong thing.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  poseColumn,
  type Harness,
} from "../harness";
import { boardSpecs } from "./board";

/** The column both cards are offered to: two cards, both face-down. */
const TARGET = 3;
/** Its cards, top of the column first, so the red nine is its lowest card. */
const TARGET_CARDS = ["#2C", "#9H"];
/** The column the King waits alone in, and the King an EMPTY column would take. */
const KING_COLUMN = 0;
const KING = "KD";
/** The column the eight waits in, and the card the buried nine would take. */
const EIGHT_COLUMN = 6;
const EIGHT = "8S";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses every card offered to a column whose lowest card is face-down", async () => {
  openTable(h);
  poseColumn(h, TARGET, TARGET_CARDS);
  poseColumn(h, KING_COLUMN, [KING]);
  poseColumn(h, EIGHT_COLUMN, [EIGHT]);
  const before = boardSpecs(h.snapshot());

  const kingAccepted = h.debug.move(
    "tableau",
    KING_COLUMN,
    0,
    "tableau",
    TARGET,
  );
  const eightAccepted = h.debug.move(
    "tableau",
    EIGHT_COLUMN,
    0,
    "tableau",
    TARGET,
  );
  const after = boardSpecs(h.snapshot());
  await h.advance(1);
  captureStill(h, "refused");

  assertEqual(
    kingAccepted,
    false,
    `move of ${KING} onto column ${TARGET}, whose lowest card is face-down: ` +
      "such a column is not an empty one and it accepts nothing " +
      "(specs/tableau.md)",
  );
  assertEqual(
    eightAccepted,
    false,
    `move of ${EIGHT} onto column ${TARGET}, whose lowest card is the ` +
      "face-down red nine: a face-down card is never read " +
      "(specs/tableau.md)",
  );
  assertDeepEqual(
    after,
    before,
    "the board after the two refused moves: both offered cards are still in " +
      "their own columns and the buried column is as it was, face-down cards " +
      "included (specs/tableau.md)",
  );
});
