// runs/keeps-order — a run that changes columns arrives in the order it left.
//
// specs/tableau.md: "A run that moves lands on its target in the order it left,
// so the card that led the run is the target's new lowest card and the rest
// follow beneath it." A column is fanned downward, so the target's cards read
// bottom to top and the run's leading card is the first of them to arrive.
//
// That the three cards arrive at all is `runs/moves-as-unit`. This point reads
// the SEQUENCE they arrive in, so a build that lands the whole run reversed, or
// that re-sorts the cards it carries, fails here and passes there.
//
// THE POSE SEPARATES THE WRONG MODELS. The three cards are distinct in rank and
// in color, so every ordering of them reads as a different column: the rule's
// `8H, 7S, 6H`, a reversal's `6H, 7S, 8H`, and anything else. Their ids are read
// alongside their faces, so a build that landed three cards of the right names
// without carrying the cards it lifted is caught too.

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

/** The column the run is lifted out of. */
const SOURCE = 0;

/** The column that accepts it. */
const TARGET = 1;

/**
 * The source column, bottom card first. `JC` is not in run order with the `8H`
 * below it, so the run a grab at {@link GRAB_ROW} takes is `8H`, `7S`, `6H`.
 */
const SOURCE_CARDS = ["JC", "8H", "7S", "6H"];

/** The run's leading card, counted from the column's bottom card at `0`. */
const GRAB_ROW = 1;

/** The run itself, in the order it lies in the source column. */
const RUN = SOURCE_CARDS.slice(GRAB_ROW);

/** The target column: a lone black `9`, which accepts a run led by a red `8`. */
const TARGET_CARDS = ["9S"];

/**
 * The target column once the run has landed, bottom card first.
 *
 * Its own card first, then the run in the order it left: the leading `8H` on top
 * of the `9S`, and the rest beneath it (specs/tableau.md).
 */
const TARGET_AFTER = [...TARGET_CARDS, ...RUN];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lands the run's cards in the order they lay in the source column", async () => {
  openTable(h);
  const posed = poseColumn(h, SOURCE, cardsOf(SOURCE_CARDS));
  const runIds = posed.slice(GRAB_ROW);
  poseColumn(h, TARGET, cardsOf(TARGET_CARDS));

  const accepted = h.debug.move("tableau", SOURCE, GRAB_ROW, "tableau", TARGET);
  await h.advance(1);
  captureStill(h, "moved");

  assertEqual(
    accepted,
    true,
    "a column whose lowest card is a black 9 to accept a run led by a red 8 " +
      "(specs/tableau.md)",
  );

  const landed = h.snapshot().tableau[TARGET];
  assertDeepEqual(
    pileText(landed),
    TARGET_AFTER,
    "the target column, bottom card first: its own card, then the run in the " +
      "order it left (specs/tableau.md)",
  );
  assertDeepEqual(
    landed.slice(TARGET_CARDS.length).map((card) => card.id),
    runIds,
    "the ids of the run's cards, in the order they left",
  );
});
