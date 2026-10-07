// runs/reject-broken-run — a lifted slice that is not in run order is refused.
//
// specs/tableau.md: "A run whose cards are not in run order is refused by every
// column and by every foundation", and a run is "one or more cards ordered so
// that each card is one rank lower than, and the opposite color of, the card
// above it". A grab takes every card below the one it pressed whether or not
// those cards make a run (specs/controls.md), so a slice can be lifted and still
// be refused everywhere.
//
// THE SLICE IS BROKEN IN ONE PLACE ONLY. `8S`, `6H`, `5S` breaks between the `8S`
// and the `6H` — two ranks apart — and its last two cards ARE in run order, so a
// build that judges only the tail of what it carries reads the slice as ordered.
//
// TWO TARGETS, TWO WRONG MODELS. The first column's lowest card is a red `9`,
// which would accept a run led by the black `8S`: a build that judges the slice
// by its leading card alone accepts there. The second column's lowest card is a
// black `7`, which would accept a run led by the red `6H`: a build that accepts
// when ANY card it carries fits accepts there. The rule refuses both, so a
// failure names which model the build implemented.
//
// The board is read afterwards as well, because specs/tableau.md has a refused
// move change nothing: the slice is still in its own column and both targets
// still hold what they held.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  poseColumn,
  type Harness,
} from "../harness";
import { cardsOf, pileText } from "./board";

/** The column the slice is lifted out of. */
const SOURCE = 0;

/**
 * The source column, bottom card first.
 *
 * A grab at {@link GRAB_ROW} takes `8S`, `6H`, `5S`: the `6H` is two ranks below
 * the `8S`, so the slice is not a run, while `6H` and `5S` are in run order with
 * each other.
 */
const SOURCE_CARDS = ["9C", "8S", "6H", "5S"];

/** The card the grab presses, counted from the column's bottom card at `0`. */
const GRAB_ROW = 1;

/**
 * The column that fits the slice's LEADING card.
 *
 * Its lowest card is a red `9`, so specs/tableau.md would have it accept a run
 * led by a black `8`. It refuses this slice because the slice is not a run.
 */
const FITS_LEAD = 1;
const FITS_LEAD_CARDS = ["9H"];

/**
 * The column that fits a card INSIDE the slice.
 *
 * Its lowest card is a black `7`, so it would accept a run led by a red `6`. The
 * slice carries a red `6`, but not as the card that leads it, so this column
 * refuses the slice too.
 */
const FITS_INNER = 2;
const FITS_INNER_CARDS = ["7C"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a slice out of run order at every column offered it", async () => {
  openTable(h);
  poseColumn(h, SOURCE, cardsOf(SOURCE_CARDS));
  poseColumn(h, FITS_LEAD, cardsOf(FITS_LEAD_CARDS));
  poseColumn(h, FITS_INNER, cardsOf(FITS_INNER_CARDS));

  const ontoLead = h.debug.move(
    "tableau",
    SOURCE,
    GRAB_ROW,
    "tableau",
    FITS_LEAD,
  );
  const ontoInner = h.debug.move(
    "tableau",
    SOURCE,
    GRAB_ROW,
    "tableau",
    FITS_INNER,
  );
  await h.advance(1);
  captureStill(h, "refused");

  assertEqual(
    ontoLead,
    false,
    "the column whose lowest card fits the slice's leading card to refuse it, " +
      "because the slice is not in run order (specs/tableau.md)",
  );
  assertEqual(
    ontoInner,
    false,
    "the column whose lowest card fits a card inside the slice to refuse it " +
      "(specs/tableau.md)",
  );

  const after = h.snapshot();
  assertDeepEqual(
    pileText(after.tableau[SOURCE]),
    SOURCE_CARDS,
    "the source column, unchanged by the two refusals (specs/tableau.md)",
  );
  assertDeepEqual(
    pileText(after.tableau[FITS_LEAD]),
    FITS_LEAD_CARDS,
    "the first target column, unchanged by the refusal (specs/tableau.md)",
  );
  assertDeepEqual(
    pileText(after.tableau[FITS_INNER]),
    FITS_INNER_CARDS,
    "the second target column, unchanged by the refusal (specs/tableau.md)",
  );
});
