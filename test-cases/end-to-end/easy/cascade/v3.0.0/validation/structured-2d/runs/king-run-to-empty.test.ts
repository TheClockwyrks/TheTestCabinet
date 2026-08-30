// runs/king-run-to-empty — an empty column accepts a run led by a King.
//
// specs/tableau.md: an empty column accepts "a run led by a King". A run is one
// or more cards, so what an empty column takes is not a King alone but the King
// and everything ordered beneath it — and specs/tableau.md's "A run that moves
// lands on its target in the order it left" fixes how it arrives.
//
// A single King onto an empty column is `tableau/king-to-empty`. This point is
// about the RUN: a build that allows only one card onto an empty column refuses
// here and passes there, so the two grade differently.
//
// THE POSE SEPARATES THE WRONG MODELS. The run is three cards long, so a build
// that accepts a King only when it is alone refuses it; the source column carries
// a `4D` above the King, so a build that carries the whole column offers a slice
// led by a `4` and refuses it, and the source is left holding something rather
// than emptying. The empty column is posed by leaving it out of the arrangement:
// `openTable` clears all thirteen piles, so nothing has to be removed from it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertDeepEqual,
  assertEqual,
  assertLength,
} from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  poseColumn,
  type Harness,
} from "../harness";
import { cardsOf, pileText } from "./board";

/** The column the run is lifted out of. */
const SOURCE = 0;

/** The column offered the run, left empty by `openTable`. */
const TARGET = 1;

/**
 * The source column, bottom card first. `4D` is not in run order with the `KS`
 * beneath it, so a grab at {@link GRAB_ROW} takes `KS`, `QH`, `JS`, which descend
 * by one and alternate black, red, black.
 */
const SOURCE_CARDS = ["4D", "KS", "QH", "JS"];

/** The run's leading King, counted from the column's bottom card at `0`. */
const GRAB_ROW = 1;

/** The run itself, in the order it lies in the source column. */
const RUN = SOURCE_CARDS.slice(GRAB_ROW);

/** Cards left in the source column: the one above the King. */
const SOURCE_AFTER = SOURCE_CARDS.slice(0, GRAB_ROW);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("fills an empty column with a run led by a King", async () => {
  openTable(h);
  const posed = poseColumn(h, SOURCE, cardsOf(SOURCE_CARDS));
  const runIds = posed.slice(GRAB_ROW);

  const accepted = h.debug.move("tableau", SOURCE, GRAB_ROW, "tableau", TARGET);
  await h.advance(1);
  captureStill(h, "accepted");

  assertEqual(
    accepted,
    true,
    "an empty column to accept a three-card run led by a King " +
      "(specs/tableau.md)",
  );

  // The once-empty column is read for WHAT arrived, not for the sequence: the
  // order a run lands in is `runs/keeps-order`, so a build that accepts the
  // King-led run and lands it backwards fails there and passes here.
  const after = h.snapshot();
  assertLength(
    after.tableau[TARGET],
    RUN.length,
    "cards on the once-empty column: the whole King-led run " +
      "(specs/tableau.md)",
  );
  const landed = after.tableau[TARGET].map((card) => card.id);
  for (const [at, id] of runIds.entries()) {
    assertContains(
      landed,
      id,
      `the run's card ${at + 1} of ${runIds.length} to be on the target column`,
    );
  }
  assertDeepEqual(
    pileText(after.tableau[SOURCE]),
    SOURCE_AFTER,
    "the source column, bottom card first (specs/tableau.md)",
  );
});
