// runs/full-run — a King-to-Ace run moves onto an empty column in one move.
//
// specs/tableau.md puts no ceiling on a run: it is "one or more cards" in
// descending, alternating order, an empty column accepts "a run led by a King",
// and a run that moves "lands on its target in the order it left". Thirteen cards
// is the longest run a deck can make, and the rule that carries three carries it.
//
// A three-card King-led run onto an empty column is `runs/king-run-to-empty`. This
// point is the extreme: a build that caps what a grab or a drop carries — at one
// card, at a handful, at whatever its hand was sized for — fails here and passes
// there.
//
// THE POSE SEPARATES THE WRONG MODELS. The source column carries a `5C` above the
// King, so a build that offers the whole column offers a slice led by a `5` and is
// refused, and the source is left holding that card rather than emptying. The move
// is ONE call, so a build that lands the run a card at a time — which no column
// would accept, since an empty column takes only a King — cannot arrive here by
// another route.

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
  pileSpecs,
  poseColumn,
  type Harness,
} from "../harness";

/** The column the run is lifted out of. */
const SOURCE = 0;

/** The column offered the run, left empty by `openTable`. */
const TARGET = 1;

/**
 * The whole thirteen-card run, King down to Ace, alternating black and red.
 *
 * Every neighboring pair is one rank apart and of opposite colors, so the whole
 * of it is a run by specs/tableau.md, and it is led by a King, which is what an
 * empty column accepts.
 */
const RUN = [
  "KS",
  "QH",
  "JS",
  "10H",
  "9S",
  "8H",
  "7S",
  "6H",
  "5S",
  "4H",
  "3S",
  "2H",
  "AS",
];

/**
 * The source column, bottom card first: one card that is not part of the run, then
 * the run itself.
 */
const SOURCE_CARDS = ["5C", ...RUN];

/** The run's leading King, counted from the column's bottom card at `0`. */
const GRAB_ROW = 1;

/** Cards left in the source column: the one above the King. */
const SOURCE_AFTER = SOURCE_CARDS.slice(0, GRAB_ROW);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("lands all thirteen cards on the empty column in one move", async () => {
  openTable(harness);
  const posed = poseColumn(harness, SOURCE, SOURCE_CARDS);
  const runIds = posed.slice(GRAB_ROW);

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
    "an empty column to accept a thirteen-card run led by a King",
  );

  const after = harness.snapshot();
  assertLength(
    after.tableau[TARGET],
    RUN.length,
    "cards on the once-empty column: the whole thirteen-card run",
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
    pileSpecs(after.tableau[SOURCE]),
    SOURCE_AFTER,
    "the source column, which keeps the card above the run",
  );
});
