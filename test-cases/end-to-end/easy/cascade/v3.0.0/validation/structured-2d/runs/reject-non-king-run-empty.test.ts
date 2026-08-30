// runs/reject-non-king-run-empty — an empty column refuses a run not led by a
// King.
//
// specs/tableau.md gives an empty column exactly one thing it accepts: "a run led
// by a King". Every other run offered to it is refused, however well ordered it
// is.
//
// This is the refusing direction of `runs/king-run-to-empty`, so a build that
// takes a King-led run and refuses everything else grades differently from one
// that takes anything.
//
// THE POSE MAKES THE KING THE ONLY THING MISSING. The run is `10S, 9H, 8S`: three
// cards in run order, led by the highest rank below a King. A build that never
// checks the leading rank accepts it, a build that compares with `>=` rather than
// equality accepts it, and only a build that asks for a King refuses. The source
// column carries a `4D` above the run, so the source does not empty and the
// arrangement holds one empty column and one only.
//
// specs/tableau.md has a refused move change nothing, and "a column that was
// empty when a run was refused by it is still empty", so the board is read
// afterwards too.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
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
 * The source column, bottom card first. `4D` is not in run order with the `10S`
 * beneath it, so a grab at {@link GRAB_ROW} takes `10S`, `9H`, `8S`, which
 * descend by one and alternate black, red, black.
 */
const SOURCE_CARDS = ["4D", "10S", "9H", "8S"];

/** The run's leading card, counted from the column's bottom card at `0`. */
const GRAB_ROW = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a run led by a 10 at an empty column", async () => {
  openTable(h);
  poseColumn(h, SOURCE, cardsOf(SOURCE_CARDS));

  const accepted = h.debug.move("tableau", SOURCE, GRAB_ROW, "tableau", TARGET);
  await h.advance(1);
  captureStill(h, "refused");

  assertEqual(
    accepted,
    false,
    "an empty column to refuse a well-ordered run led by a 10, because only a " +
      "run led by a King fills an empty column (specs/tableau.md)",
  );

  const after = h.snapshot();
  assertLength(
    after.tableau[TARGET],
    0,
    "cards on the column that refused the run, which was empty and stays " +
      "empty (specs/tableau.md)",
  );
  assertDeepEqual(
    pileText(after.tableau[SOURCE]),
    SOURCE_CARDS,
    "the source column, unchanged by the refusal (specs/tableau.md)",
  );
});
