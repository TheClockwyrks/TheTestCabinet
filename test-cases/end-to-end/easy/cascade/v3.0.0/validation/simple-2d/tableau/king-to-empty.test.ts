// tableau/king-to-empty — an empty column takes a King.
//
// specs/tableau.md: a column that is empty "accepts a run led by a King". A single
// card is a run of one, so a King alone is a run led by a King.
// specs/instrumentation.md: `move` returns `true` when the game's own rules accepted
// it, and an accepted move applies through the same path a released drop uses.
//
// THE POSE. One King alone in a source column, one column left empty, and no other
// card anywhere, so nothing but the empty column's rule can decide the verdict. The
// eleven remaining piles are empty too, so a build that routed the King somewhere
// else of its own accord shows it: the King is read where the move named, not merely
// counted as gone.
//
// THE COLUMN IS NOT COLUMN 0. An empty column is empty whichever of the seven it is,
// and a build that answers only for the first, or that reads a column's emptiness
// off the deal's shape, fails here.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  pileSpecs,
  poseColumn,
  type Harness,
} from "../harness";

/** The column left empty, which the King is offered to. */
const TARGET = 4;
/** The column the King waits alone in. */
const SOURCE = 1;
/** The King offered. Its suit is arbitrary: an empty column takes any King. */
const KING = "KD";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("accepts a King onto an empty column", async () => {
  openTable(h);
  poseColumn(h, SOURCE, [KING]);

  const accepted = h.debug.move("tableau", SOURCE, 0, "tableau", TARGET);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "accepted");

  assertEqual(
    accepted,
    true,
    `move of ${KING} onto empty column ${TARGET}, which accepts a run led ` +
      "by a King (specs/tableau.md)",
  );
  assertDeepEqual(
    pileSpecs(after.tableau[TARGET]),
    [KING],
    `column ${TARGET} after the move: the King, and it alone ` +
      "(specs/tableau.md)",
  );
  assertLength(
    after.tableau[SOURCE],
    0,
    `the cards left in column ${SOURCE}: the King has left it ` +
      "(specs/tableau.md)",
  );
});
