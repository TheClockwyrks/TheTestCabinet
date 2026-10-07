// runs/moves-as-unit — a valid run changes columns as one thing.
//
// specs/tableau.md defines a run as "one or more cards ordered so that each card
// is one rank lower than, and the opposite color of, the card above it", and says
// that "a move out of a column takes one of its face-up cards and every card below
// it in that column". So a three-card descending-alternating run offered to a
// column that accepts its leading card arrives WHOLE: every card of the run leaves
// the source and lands on the target, and nothing of it is left behind.
//
// This point decides the unit, not the order the three arrive in; that is
// `runs/keeps-order`, which poses the same table and reads the sequence.
//
// THE POSE SEPARATES THE WRONG MODELS. The source column carries one card ABOVE
// the run that is not in run order with it, so each wrong model lands a different
// number of cards on the target: a build that carries the whole column lands four,
// a build that carries the grabbed card alone lands one, a build that drops the
// tail of a run lands two, and only the rule specs/tableau.md states lands three.
// The card above is also what keeps the source column from emptying, so nothing
// here touches the exposed-card rule.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  poseColumn,
  type Harness,
} from "../harness";

/** The column the run is lifted out of. */
const SOURCE = 0;

/** The column offered the run. */
const TARGET = 1;

/**
 * The source column, bottom card first.
 *
 * `JC` is neither one rank above `8H` nor the opposite color of it, so it is not
 * part of the run a grab at {@link GRAB_ROW} takes (specs/tableau.md). `8H`, `7S`
 * and `6H` descend by one and alternate red, black, red, which is a run.
 */
const SOURCE_CARDS = ["JC", "8H", "7S", "6H"];

/** The run's leading card, counted from the column's bottom card at `0`. */
const GRAB_ROW = 1;

/** Cards of the source column the run leaves behind: the ones above it. */
const LEFT_BEHIND = GRAB_ROW;

/**
 * The target column: a lone black `9`.
 *
 * specs/tableau.md has a column whose lowest card is face-up, of rank `r` and
 * color `c`, accept "a run led by a card of rank `r - 1` and the color other than
 * `c`". The run is led by the red `8H`, so this column accepts it.
 */
const TARGET_CARDS = ["9S"];

/** Cards on the target once the run has landed: its own card and the three. */
const TARGET_AFTER = TARGET_CARDS.length + (SOURCE_CARDS.length - GRAB_ROW);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("lands every card of a three-card run on the column that accepts it", async () => {
  openTable(harness);
  const posed = poseColumn(harness, SOURCE, SOURCE_CARDS);
  const runIds = posed.slice(GRAB_ROW);
  poseColumn(harness, TARGET, TARGET_CARDS);

  const accepted = harness.debug.move(
    "tableau",
    SOURCE,
    GRAB_ROW,
    "tableau",
    TARGET,
  );
  await harness.advance(1);
  captureStill(harness, "moved");

  assertEqual(
    accepted,
    true,
    "a column whose lowest card is a black 9 to accept a run led by a red 8",
  );

  const after = harness.snapshot();
  assertLength(
    after.tableau[TARGET],
    TARGET_AFTER,
    "cards on the target column: its own card and the whole run",
  );
  const landed = after.tableau[TARGET].map((card) => card.id);
  for (const [at, id] of runIds.entries()) {
    assertContains(
      landed,
      id,
      `the run's card ${at + 1} of ${runIds.length} to be on the target column`,
    );
  }
  assertLength(
    after.tableau[SOURCE],
    LEFT_BEHIND,
    "cards left in the source column: the one above the run",
  );
});
