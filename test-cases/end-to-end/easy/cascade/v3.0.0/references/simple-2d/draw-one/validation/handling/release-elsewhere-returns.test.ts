// handling/release-elsewhere-returns — a release whose leading card's center lies in
// no pile's rectangle returns the run.
//
// specs/controls.md: a drop whose leading card's center lies "in no pile's
// rectangle" has "the run returns to the pile it was lifted from", and specs/table.md
// fixes the thirteen rectangles the center is tested against: "The top row's
// rectangles end at `y = 164` and the columns' begin at `y = 180`, so no two of the
// thirteen rectangles overlap and a point lies in at most one of them. A point in
// none of them lies on no pile."
//
// WHERE THE RELEASE LANDS. In the `22`-unit gap specs/table.md fixes between two
// columns, at a height that is inside both columns' rectangles — so the ONLY reason
// the center lies in no rectangle is the horizontal gap, and the check turns on the
// figure rather than on some far corner of the stage where every reading agrees.
//
// THE NEIGHBOR WOULD HAVE TAKEN THE RUN. The column on the near side of the gap
// holds a black six, which accepts the red five being carried (specs/tableau.md),
// and the center is left nearer to that column than to the one the run came from.
// So a build that resolves a drop by which pile the card OVERLAPS, or by which pile
// is nearest, lands the run on that column and fails; a build that tests the center
// against the rectangles returns it. Without a neighbor that accepts, every one of
// those builds would return the run too and the point would decide nothing.

import { afterEach, beforeEach, it } from "vitest";
import { COLUMN_X } from "../../src/constants";
import { assertDeepEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  drag,
  openTable,
  pileSpecs,
  poseColumn,
  pressPoint,
  type Harness,
  type Point,
} from "../harness";

/** The column the run is lifted from, and the run: one red five. */
const FROM_COLUMN = 0;
const RUN = "5H";

/** The column across the gap, and the card that would accept the run. */
const NEIGHBOR = 1;
const NEIGHBOR_CARD = "6S";

/**
 * How far inside the gap, measured back from the neighbor's left edge, the release
 * lands.
 *
 * The gap between two columns is `22` units wide (specs/table.md: a pitch of `122`
 * is "a `100`-wide card and a `22` gap"), so `8` lies inside it, and it leaves the
 * point `8` units from the neighbor's rectangle against `14` from the source
 * column's — nearer to the pile that would have taken the run.
 */
const GAP_INSET = 8;

/**
 * The height the release lands at: inside the vertical span of both columns'
 * rectangles, which for a column holding one card runs from `TABLEAU_Y` (`180`) to
 * that card's bottom edge (`320`). So the point misses every rectangle horizontally
 * and nothing else.
 */
const RELEASE_Y = 300;

/** Where the leading card's center is left, which is the point the rule tests. */
const CENTER: Point = { x: COLUMN_X[NEIGHBOR] - GAP_INSET, y: RELEASE_Y };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns the run to its source when the release lies in no pile's rectangle", async () => {
  openTable(h);
  poseColumn(h, FROM_COLUMN, [RUN]);
  poseColumn(h, NEIGHBOR, [NEIGHBOR_CARD]);

  // The press is at the card's center, so the pointer and the leading card's
  // center are the same point for the whole gesture and the release IS the center
  // the rule is applied to.
  const press = pressPoint(h.snapshot(), "tableau", FROM_COLUMN, 0);
  drag(h, press, CENTER);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "returned");

  assertDeepEqual(
    pileSpecs(after.tableau[FROM_COLUMN]),
    [RUN],
    `column ${FROM_COLUMN} after a release ${GAP_INSET} units short of ` +
      `column ${NEIGHBOR}'s left edge, in the gap between the two: a center ` +
      "in no pile's rectangle returns the run to the pile it was lifted from " +
      "(specs/controls.md, specs/table.md)",
  );
  assertDeepEqual(
    pileSpecs(after.tableau[NEIGHBOR]),
    [NEIGHBOR_CARD],
    `column ${NEIGHBOR} after that release: the run resolved to no pile, so ` +
      "the column it was left nearest to — and which would have accepted it — " +
      "took nothing (specs/controls.md)",
  );
  assertNull(
    after.drag,
    "the hand after the release: the gesture ended with it " +
      "(specs/controls.md)",
  );
});
