// handling/release-on-illegal-returns — a release over a pile that refuses the
// run puts it back.
//
// THE RULE. specs/controls.md: a drop whose leading card's centre lies "In the
// rectangle of a pile that refuses the run" has "The run returns to the pile it
// was lifted from." specs/tableau.md states what returning means: "Every card it
// carried returns to the pile it was taken from, in the order it left, with every
// face as it was, and the target keeps what it held."
//
// THE RUN IS TWO CARDS, deliberately. A one-card run cannot tell "returned in
// order" from "returned somehow", and a build that reverses a returned run, or
// that puts it back under the cards left behind, reads as a different column here
// and as the same one with a single card.
//
// THE TARGET REFUSES. A run led by a red six over a column whose lowest card is a
// red seven is one rank lower but the SAME colour, and specs/tableau.md accepts
// only "the colour other than `c`". The source column keeps its black seven, so
// the run would be accepted back there — which is what the return puts it on, and
// which is why "in order" is the whole reading.
//
// THE GESTURE IS UNAMBIGUOUSLY A DROP. The release lies about `127` units from
// its press, far past `DRAG_THRESHOLD` (`5`), and `handling/short-gesture-is-a-click` and
// `handling/long-gesture-is-a-drop` are the point that decides the threshold itself.
//
// WHAT IS READ. The source column, exactly as it was posed, and the target
// column, still holding only its own card.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNull } from "../assert";
import {
  captureStill,
  card,
  cardTopLeft,
  createHarness,
  drag,
  FIVE,
  grabPoint,
  openTable,
  pileTopLeft,
  poseColumn,
  SEVEN,
  SIX,
  type Harness,
} from "../harness";
import { carryTo, pileText } from "./gestures";

/** The column the run is lifted from, and the column it is released over. */
const FROM_COLUMN = 0;
const TO_COLUMN = 1;

/**
 * The source column, bottom-most card first: a black seven, a red six and a black
 * five, which is a run by specs/tableau.md.
 */
const SOURCE = [
  card("spades", SEVEN),
  card("hearts", SIX),
  card("clubs", FIVE),
];

/** The row the press lands on: the red six, so the run in hand is two cards. */
const FROM_ROW = 1;

/** The target's card: a red seven, the same colour as the run's leader. */
const TARGET = card("diamonds", SEVEN);

/** The two columns as they must read after the refused release. */
const RETURNED = ["7S", "6H", "5C"];
const UNTOUCHED = ["7D"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts the run back in its source column, in order, and leaves the target as it was", async () => {
  openTable(h);
  poseColumn(h, FROM_COLUMN, SOURCE);
  poseColumn(h, TO_COLUMN, [TARGET]);

  const posed = h.snapshot();
  const press = grabPoint(posed, FROM_COLUMN, FROM_ROW);
  const lead = cardTopLeft(posed, "tableau", FROM_COLUMN, FROM_ROW);
  const release = carryTo(press, lead, pileTopLeft("tableau", TO_COLUMN));

  drag(h, press, release);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "returned");

  assertDeepEqual(
    pileText(after.tableau[FROM_COLUMN]),
    RETURNED,
    `column ${String(FROM_COLUMN)} after the refused release: every card the ` +
      "run carried is back in the order it left, with every face as it was " +
      "(specs/controls.md, specs/tableau.md)",
  );
  assertDeepEqual(
    pileText(after.tableau[TO_COLUMN]),
    UNTOUCHED,
    `column ${String(TO_COLUMN)} after the refused release: the target keeps ` +
      "what it held (specs/tableau.md)",
  );
  assertNull(
    after.drag,
    "the run in hand after the release, which ended the gesture " +
      "(specs/controls.md)",
  );
});
