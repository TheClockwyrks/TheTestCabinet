// runs/onto-legal-card — a column accepts a run by the run's LEADING card.
//
// specs/tableau.md: a column "whose lowest card is face-up, of rank `r` and color
// `c`" accepts "a run led by a card of rank `r - 1` and the color other than
// `c`", and "a run is led by its highest card, which is the card that lands on
// the target".
//
// So acceptance is decided by one card of the run and one card of the column, and
// this point decides the accepting direction. The two refusing directions are
// `runs/reject-wrong-color` and `runs/reject-wrong-rank`, which pose the same
// table and break exactly one of the two conditions.
//
// THE POSE SEPARATES THE WRONG MODELS. The target's lowest card is a red `9` and
// the run is `8S, 7H, 6S`: its leading `8S` is a black `8`, which fits, while its
// TRAILING `6S` is a black `6`, which does not. A build that judges the run by the
// card at its other end refuses, and a build that judges by the whole run's
// aggregate has nothing to aggregate to `8` and black. The source column carries a
// card above the run, so it does not empty and the empty-column rule stays out of
// the reading.

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

/** The column offered the run. */
const TARGET = 1;

/**
 * The source column, bottom card first. `2C` is not in run order with the `8S`
 * beneath it, so a grab at {@link GRAB_ROW} takes `8S`, `7H`, `6S`.
 */
const SOURCE_CARDS = ["2C", "8S", "7H", "6S"];

/** The run's leading card, counted from the column's bottom card at `0`. */
const GRAB_ROW = 1;

/** The run itself, in the order it lies in the source column. */
const RUN = SOURCE_CARDS.slice(GRAB_ROW);

/**
 * The target column: a lone red `9`.
 *
 * `r` is `9` and `c` is red, so the run it accepts is led by a black `8`, which
 * is the `8S` at the head of {@link RUN}. Its trailing `6S` fits nothing about
 * it.
 */
const TARGET_CARDS = ["9D"];

/** Cards on the target once the run has landed: its own card and the three. */
const TARGET_AFTER = TARGET_CARDS.length + RUN.length;

/** Cards left in the source column: the one above the run. */
const SOURCE_AFTER = SOURCE_CARDS.slice(0, GRAB_ROW);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("accepts a run whose leading card is one lower and the opposite color", async () => {
  openTable(h);
  const posed = poseColumn(h, SOURCE, cardsOf(SOURCE_CARDS));
  const runIds = posed.slice(GRAB_ROW);
  poseColumn(h, TARGET, cardsOf(TARGET_CARDS));

  const accepted = h.debug.move("tableau", SOURCE, GRAB_ROW, "tableau", TARGET);
  await h.advance(1);
  captureStill(h, "accepted");

  assertEqual(
    accepted,
    true,
    "a column whose lowest card is a red 9 to accept a run led by a black 8 " +
      "(specs/tableau.md)",
  );

  // The target is read for WHAT arrived, not for the sequence it arrived in:
  // the order a run lands in is `runs/keeps-order`, so a build that accepts the
  // run and lands it backwards fails there and passes here.
  const after = h.snapshot();
  assertLength(
    after.tableau[TARGET],
    TARGET_AFTER,
    "cards on the target column: its own card and the whole run " +
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
