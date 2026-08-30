// instrumentation/set-card-face — `setCardFaceUp` turns one card, and one card
// only.
//
// specs/instrumentation.md: `setCardFaceUp(id, faceUp)` "sets one card's face".
//
// WHY THE SUITE RESTS ON IT. A column's faces decide what a press may lift
// (specs/controls.md), what the automatic flip does (specs/tableau.md) and where
// every card below is drawn (specs/table.md), so a scenario that needs a particular
// card face-down poses it with this operation. A build that turned the whole pile,
// or that turned the pile's top card whatever id it was given, would silently
// rewrite those scenarios.
//
// BOTH DIRECTIONS ARE THEIR OWN CHECK, because they are different builds: one that
// can only turn a card up passes the first and fails the second, and one that
// ignores the argument and toggles passes whichever direction happens to agree with
// the face the card already had. So each direction poses the card at the OPPOSITE
// face first, and reads the face it was then given.
//
// THE BOARD CARRIES OTHER CARDS AT BOTH FACES, in the same column as the card under
// test and in another column, so "no other card's face changes" is something to
// read rather than a vacuous truth on a board of one card.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  cardOf,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  type Harness,
} from "../harness";

/** The column the card under test sits in, and the cards around it. */
const COLUMN = 1;
const NEIGHBOURS_BELOW = ["#5D", "8C"];
const NEIGHBOURS_ABOVE = ["#3H", "7S"];

/** A second column, so a card outside the one under test is watched too. */
const OTHER_COLUMN = 4;
const OTHER_CARDS = ["#2S", "9H", "#4C"];

/** The card whose face is set, written both ways up. */
const CARD_FACE_UP = "6D";
const CARD_FACE_DOWN = "#6D";

/** The row it sits at, which is the number of cards posed beneath it. */
const CARD_ROW = NEIGHBOURS_BELOW.length;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Pose the two columns with the card under test at `spec`, and answer its id. */
function poseFaces(spec: string): number {
  openTable(h);
  const ids = poseColumn(h, COLUMN, [
    ...NEIGHBOURS_BELOW,
    spec,
    ...NEIGHBOURS_ABOVE,
  ]);
  poseColumn(h, OTHER_COLUMN, OTHER_CARDS);
  return ids[CARD_ROW];
}

/** The faces of every card on the board but the one under test. */
function otherFaces(id: number): boolean[] {
  const snapshot = h.snapshot();
  return [
    ...pileOf(snapshot, "tableau", COLUMN).filter((card) => card.id !== id),
    ...pileOf(snapshot, "tableau", OTHER_COLUMN),
  ].map((card) => card.faceUp);
}

it("turns a posed face-down card face-up, and no other card", async () => {
  const id = poseFaces(CARD_FACE_DOWN);
  const before = otherFaces(id);

  h.debug.setCardFaceUp(id, true);
  const after = h.snapshot();

  // The card posed face-down and then turned face-up.
  await h.advance(1);
  captureStill(h, "faces");

  assertEqual(
    cardOf(after, id).faceUp,
    true,
    `setCardFaceUp(id, true) on the ${CARD_FACE_UP} posed face-down ` +
      "(specs/instrumentation.md)",
  );
  assertDeepEqual(
    otherFaces(id),
    before,
    "the faces of every other card on the board: setCardFaceUp sets one " +
      "card's face (specs/instrumentation.md)",
  );
});

it("turns a posed face-up card face-down, and no other card", async () => {
  const id = poseFaces(CARD_FACE_UP);
  const before = otherFaces(id);

  h.debug.setCardFaceUp(id, false);
  const after = h.snapshot();

  await h.advance(1);

  assertEqual(
    cardOf(after, id).faceUp,
    false,
    `setCardFaceUp(id, false) on the ${CARD_FACE_UP} posed face-up ` +
      "(specs/instrumentation.md)",
  );
  assertDeepEqual(
    otherFaces(id),
    before,
    "the faces of every other card on the board: setCardFaceUp sets one " +
      "card's face (specs/instrumentation.md)",
  );
});
