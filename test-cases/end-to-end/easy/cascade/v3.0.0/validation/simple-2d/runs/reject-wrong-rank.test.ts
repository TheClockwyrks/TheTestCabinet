// runs/reject-wrong-rank — a run whose leading card is not one rank below the
// target's lowest card is refused.
//
// specs/tableau.md has a column whose lowest card is face-up, of rank `r` and
// color `c`, accept "a run led by a card of rank `r - 1` and the color other than
// `c`", and "refuses every other run offered to it".
//
// This point decides the rank half of that condition, in the refusing direction.
// The accepting direction is `runs/onto-legal-card` and the color half is
// `runs/reject-wrong-color`, so a build that has one of the two conditions right
// grades differently from a build that has neither.
//
// THE POSE ISOLATES THE RANK. The target's lowest card is a red `9` and the run is
// led by a black `7`: the color is exactly the one the rule asks for, so the only
// thing that can refuse this run is its rank. Two ranks below rather than one is
// the distinguishing value — a build that accepts anything lower accepts it, and a
// build that accepts any card of the opposite color accepts it, while a build that
// reads `r - 1` refuses. The run is in run order throughout, so nothing about run
// order can be what refuses it.
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
 * The source column, bottom card first. `2C` is not in run order with the `7S`
 * beneath it, so a grab at {@link GRAB_ROW} takes `7S`, `6H`, `5S`, which descend
 * by one and alternate black, red, black.
 */
const SOURCE_CARDS = ["2C", "7S", "6H", "5S"];

/** The run's leading card, counted from the column's bottom card at `0`. */
const GRAB_ROW = 1;

/**
 * The target column: a lone red `9`.
 *
 * The run is led by the black `7S`. Its color is the other one, so the color
 * condition holds; its rank is `9 - 2` rather than `9 - 1`, so the rank condition
 * fails and the column refuses it.
 */
const TARGET_CARDS = ["9D"];

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("refuses a run whose leading card is two ranks below the column's", async () => {
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
    "a column whose lowest card is a red 9 to refuse a run led by a black 7, " +
      "whose color fits and whose rank does not",
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
