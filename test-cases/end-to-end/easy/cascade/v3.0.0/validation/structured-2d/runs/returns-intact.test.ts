// runs/returns-intact — a refused run goes back to its own column exactly as it
// left.
//
// specs/tableau.md: "A refused move changes nothing. Every card it carried
// returns to the pile it was taken from, in the order it left, with every face as
// it was, and the target keeps what it held." specs/controls.md fixes when that
// happens: a drop whose leading card's center lies "in the rectangle of a pile
// that refuses the run" returns the run to the pile it was lifted from.
//
// THIS POINT IS DRIVEN AS A GESTURE, not as a move, because the run has to LEAVE
// its column before it can return to it: specs/controls.md has the run leave the
// pile "as it enters the hand", so the pile really is short of those cards for
// the length of the gesture and the state read afterwards is the state the return
// rebuilt.
//
// THE POSE SEPARATES THE WRONG MODELS. The run is three cards, distinct in rank
// and color, so a return that reverses them, drops one, or re-sorts them reads as
// a different column; a `KC` sits above them, so a column rebuilt from the run
// alone is short a card and a run appended rather than restored puts the `KC` in
// the wrong place. Every card is face-up, so the exposed-card rule never applies
// and this reading is about the return alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  drag,
  openTable,
  poseColumn,
  type Harness,
} from "../harness";
import { cardsOf, pileText } from "./board";
import { columnGrab, releaseOn } from "./grab";

/** The column the run is lifted out of. */
const SOURCE = 0;

/** The column the run is dropped on, which refuses it. */
const TARGET = 1;

/**
 * The source column, bottom card first, every card face-up.
 *
 * `KC` is not in run order with the `8S` beneath it, so a grab at
 * {@link GRAB_ROW} takes `8S`, `7H`, `6S` and leaves the `KC` behind.
 */
const SOURCE_CARDS = ["KC", "8S", "7H", "6S"];

/** The run's leading card, counted from the column's bottom card at `0`. */
const GRAB_ROW = 1;

/**
 * The target column: a lone red `6`.
 *
 * specs/tableau.md would have it accept a run led by a black `5`. The run is led
 * by a black `8`, so the column refuses it and the drop returns the run.
 */
const TARGET_CARDS = ["6D"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts a refused run back in its own column, in order and face-up", async () => {
  openTable(h);
  const posed = poseColumn(h, SOURCE, cardsOf(SOURCE_CARDS));
  poseColumn(h, TARGET, cardsOf(TARGET_CARDS));

  const before = h.snapshot();
  const grab = columnGrab(before, SOURCE, GRAB_ROW);
  drag(h, grab.at, releaseOn(before, grab, "tableau", TARGET));
  await h.advance(1);
  captureStill(h, "returned");

  const after = h.snapshot();
  assertNull(after.drag, "the hand after the release, which holds nothing");
  assertDeepEqual(
    pileText(after.tableau[SOURCE]),
    SOURCE_CARDS,
    "the source column the refused run returned to, bottom card first, with " +
      "every face as it was (specs/tableau.md)",
  );
  assertDeepEqual(
    after.tableau[SOURCE].map((card) => card.id),
    posed,
    "the ids of the source column's cards, bottom card first",
  );
  for (const [at, card] of after.tableau[SOURCE].entries()) {
    assertEqual(
      card.faceUp,
      true,
      `the face of the returned column's card at row ${at}`,
    );
  }
  assertDeepEqual(
    pileText(after.tableau[TARGET]),
    TARGET_CARDS,
    "the column that refused the run, which keeps what it held " +
      "(specs/tableau.md)",
  );
});
