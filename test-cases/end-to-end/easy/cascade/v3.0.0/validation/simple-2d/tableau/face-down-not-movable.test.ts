// tableau/face-down-not-movable — a face-down card is never the source of a move.
//
// specs/tableau.md: "a move whose taken card is face-down is refused, and the board
// is left exactly as it was", and "a face-down card is never moved and is never
// read. It becomes playable only once it has been turned this way."
// specs/instrumentation.md: `move`'s `fromRow` is "the index of the grabbed card
// within its pile, counted from the bottom", and the grabbed card and every card the
// pile holds after it move together, so a row naming a face-down card is exactly the
// move this rule refuses.
//
// THE POSE IS WRITTEN SO THE WRONG ANSWER IS AN ACCEPTANCE, NOT A COINCIDENCE. The
// face-down card is the red nine with the black eight face-up below it, and the
// target column's lowest card is the black ten. Were the face-down nine read, the
// pair would be an ordered run led by a card one rank lower than the ten and the
// other color — a move every one of this group's other rules accepts. So a build
// that omits the face-down test accepts it here, and a build that refuses it cannot
// be refusing for the target's sake.
//
// WHAT IS READ. The verdict, and the whole board against the board before the move:
// a build that refused the move but turned the face-down card over on the way, or
// carried the eight along anyway, is not leaving the board "exactly as it was".

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

/** The column the move names as its source. */
const SOURCE = 2;
/** Its face-down card, at row 0, which the move names. */
const FACE_DOWN = "#9H";
/** The face-up card below it, which would travel with it were the move allowed. */
const BELOW = "8S";
/** The column named as the target, and the card a read nine would land on. */
const TARGET = 6;
const TARGET_LOWEST = "10S";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a move whose source card is face-down", async () => {
  openTable(h);
  poseColumn(h, SOURCE, [FACE_DOWN, BELOW]);
  poseColumn(h, TARGET, [TARGET_LOWEST]);
  const before = boardSpecs(h.snapshot());

  const accepted = h.debug.move("tableau", SOURCE, 0, "tableau", TARGET);
  const after = boardSpecs(h.snapshot());
  await h.advance(1);
  captureStill(h, "refused");

  assertEqual(
    accepted,
    false,
    `move naming row 0 of column ${SOURCE}, which is the face-down ` +
      `${FACE_DOWN}: a face-down card is never moved (specs/tableau.md)`,
  );
  assertDeepEqual(
    after,
    before,
    "the board after the refused move: both cards are still in their column, " +
      "in order, and the face-down one is still face-down " +
      "(specs/tableau.md)",
  );
});
