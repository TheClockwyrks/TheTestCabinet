// runs/run-of-one — one card on its own is a run, and moves like one.
//
// specs/tableau.md: "A single card is a run of one", and a move out of a column
// "takes one of its face-up cards and every card below it in that column" — which,
// for the column's lowest card, is that card alone. So the column's lowest card
// moves onto any target that accepts a run led by it.
//
// THE POSE SEPARATES THE WRONG MODELS. The source column holds two face-up cards
// that are NOT in run order with each other, and the grab presses the lower of
// them. A build that carries only what was pressed offers a run of one, which the
// target accepts; a build that carries the whole column offers `4C, 6D`, which is
// not a run and which every column refuses (specs/tableau.md), so the verdict
// itself tells the two apart. The card left behind then says which of them ran:
// the rule leaves the `4C` in the column, and nothing else does.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  pileSpecs,
  poseColumn,
  type Harness,
} from "../harness";

/** The column the card is lifted out of. */
const SOURCE = 0;

/** The column offered the card. */
const TARGET = 1;

/**
 * The source column, bottom card first, both cards face-up.
 *
 * `4C` is neither one rank above `6D` nor the opposite color of it, so the two are
 * not a run and a grab at {@link GRAB_ROW} takes the `6D` alone.
 */
const SOURCE_CARDS = ["4C", "6D"];

/** The column's lowest card, counted from its bottom card at `0`. */
const GRAB_ROW = SOURCE_CARDS.length - 1;

/** The run: the one card the grab takes. */
const RUN = SOURCE_CARDS.slice(GRAB_ROW);

/**
 * The target column: a lone black `7`.
 *
 * specs/tableau.md has it accept a run led by a red `6`, which the `6D` is when it
 * travels alone and is not when it travels under the `4C`.
 */
const TARGET_CARDS = ["7S"];

/** The target column once the card has landed, bottom card first. */
const TARGET_AFTER = [...TARGET_CARDS, ...RUN];

/** Cards left in the source column: the one above the card taken. */
const SOURCE_AFTER = SOURCE_CARDS.slice(0, GRAB_ROW);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("moves a column's lowest card alone onto a column that accepts it", async () => {
  openTable(harness);
  poseColumn(harness, SOURCE, SOURCE_CARDS);
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
    "a column whose lowest card is a black 7 to accept the single red 6 " +
      "offered to it as a run of one",
  );

  const after = harness.snapshot();
  assertDeepEqual(
    pileSpecs(after.tableau[TARGET]),
    TARGET_AFTER,
    "the target column, bottom card first",
  );
  assertDeepEqual(
    pileSpecs(after.tableau[SOURCE]),
    SOURCE_AFTER,
    "the source column, which keeps the card above the one that moved",
  );
});
