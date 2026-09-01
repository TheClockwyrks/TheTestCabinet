// handling/press-face-down-grabs-nothing — a press on a face-down card lifts
// nothing.
//
// specs/controls.md's grab table: a press on "a face-down card" lifts "Nothing".
// specs/tableau.md says why it must: "A face-down card is never moved and is never
// read. It becomes playable only once it has been turned this way." So the press
// leaves `drag` null and leaves the card where it lies.
//
// THE COLUMN HOLDS THAT CARD ALONE. A face-down card with a face-up card below it
// would be fanned over, and a press on the part of it that is drawn over everything
// else — the strip above the card below — is a different scenario from this one;
// worse, a press at its center would resolve to the card BELOW it
// (specs/controls.md) and the check would grade a face-up grab. One face-down card
// in one column is the smallest world where a press lands on a face-down card and on
// nothing else, and its whole footprint answers.
//
// WHAT IS READ. `drag` is `null`, which is the item, and the board is what it was,
// which is the same fact from the pile's side: a build that lifted the card would
// have taken it out of the column as it entered the hand (specs/controls.md).

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  poseColumn,
  pressPoint,
  type Harness,
} from "../harness";
import { boardAndHand } from "./board";

/** The column the face-down card lies in. */
const COLUMN = 4;

/** That column's one card, face-down. */
const CARD = "#7D";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the hand empty and the card in place on a press over a face-down card", async () => {
  openTable(h);
  poseColumn(h, COLUMN, [CARD]);
  const before = boardAndHand(h.snapshot());

  const at = pressPoint(h.snapshot(), "tableau", COLUMN, 0);
  h.debug.pointerDown(at.x, at.y);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "unheld");

  assertNull(
    after.drag,
    `the run in hand after a press on the face-down ${CARD} in column ` +
      `${COLUMN}: a press on a face-down card lifts nothing ` +
      "(specs/controls.md)",
  );
  assertDeepEqual(
    boardAndHand(after),
    before,
    "the board and the hand after that press: a card that was not lifted has " +
      "not left its pile either (specs/controls.md, specs/tableau.md)",
  );
});
