// runs/reject-wrong-color — a run led by a card of the target's own color is
// refused.
//
// specs/tableau.md has a column whose lowest card is face-up, of rank `r` and
// color `c`, accept "a run led by a card of rank `r - 1` and the color other than
// `c`", and "refuses every other run offered to it".
//
// This point decides the color half of that condition, in the refusing direction.
// The accepting direction is `runs/onto-legal-card` and the rank half is
// `runs/reject-wrong-rank`, so a build that has one of the two conditions right
// grades differently from a build that has neither.
//
// THE POSE ISOLATES THE COLOR. The target's lowest card is a red `9` and the run
// is led by a red `8`: the rank is exactly the `r - 1` the rule asks for, so the
// only thing that can refuse this run is its color. A build that never compares
// colors accepts it, and a build that compares them the wrong way round accepts it
// too. The run is in run order throughout, so nothing about run order can be what
// refuses it either.
//
// specs/tableau.md has a refused move change nothing, so the board is read after
// the refusal as well as the verdict.

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

/** The column the run is lifted out of. */
const SOURCE = 0;

/** The column offered the run. */
const TARGET = 1;

/**
 * The source column, bottom card first. `2C` is not in run order with the `8H`
 * beneath it, so a grab at {@link GRAB_ROW} takes `8H`, `7S`, `6H`, which descend
 * by one and alternate red, black, red.
 */
const SOURCE_CARDS = ["2C", "8H", "7S", "6H"];

/** The run's leading card, counted from the column's bottom card at `0`. */
const GRAB_ROW = 1;

/**
 * The target column: a lone red `9`.
 *
 * The run is led by the red `8H`. Its rank is `9 - 1`, so the rank condition
 * holds; its color is the column's own, so the color condition fails and the
 * column refuses it.
 */
const TARGET_CARDS = ["9D"];

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("refuses a run whose leading card matches the column's color", async () => {
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
  captureStill(harness, "refused");

  assertEqual(
    accepted,
    false,
    "a column whose lowest card is a red 9 to refuse a run led by a red 8, " +
      "whose rank fits and whose color does not",
  );

  const after = harness.snapshot();
  assertDeepEqual(
    pileSpecs(after.tableau[SOURCE]),
    SOURCE_CARDS,
    "the source column, unchanged by the refusal",
  );
  assertDeepEqual(
    pileSpecs(after.tableau[TARGET]),
    TARGET_CARDS,
    "the target column, unchanged by the refusal",
  );
});
