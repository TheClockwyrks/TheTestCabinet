// table/tableau-anchor-y — a column's first card has its top edge at y = 180.
//
// THE RULE. `specs/table.md`: "Each column begins at `TABLEAU_Y` (`180`), at its
// own `COLUMN_X`", and "a column's first card has its top edge at `y = 180`".
//
// THE POSE, AND WHY IT IS COLUMN 2 ALONE. One face-up card on column 2 and
// nothing anywhere else. `COLUMN_X[2]` is `468`, the third column position, and
// `specs/table.md` fixes that it "carries no pile in the top row" — it is the one
// column anchor no other pile on the table shares. So every card-sized shape
// whose left edge is `468` belongs to that column, whatever `y` the build drew it
// at, and this check needs no band by `y` at all: a build that anchored its
// columns at `100` or at `260` is READ rather than missed, and is named for the
// figure it drew.
//
// One card rather than several, and the reading is of that one card's top edge:
// how far the card below it is offset is `table/face-up-offset`, and the `x` the
// column is laid at is `table/column-anchors`.
//
// WHAT IS READ. Every card-sized shape whose left edge is the column's anchor.
// The column holds a card, so it is not empty and the card-sized mark
// `specs/table.md` gives an empty pile is not among them; and a build is free to
// spend more than one shape on a card, so what is required of the reading is that
// EVERY shape it found has its top edge at `180` — an outer plate at `180` with an
// inner panel at `180` is one card at the anchor, and a plate at `180` with a
// second card-sized shape somewhere else is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertGreaterThan } from "../assert";
import { COLUMN_X, TABLEAU_Y } from "../constants";
import {
  captureStill,
  cardFootprints,
  columnOfCards,
  createHarness,
  openTable,
  poseColumn,
  type Harness,
} from "../harness";

/** The column posed: the one anchor no top-row pile shares (`468`). */
const COLUMN = 2;

/** One card, which is the column's first card and the whole of it. */
const CARDS = 1;

/**
 * How far a painted shape's size may sit from the card footprint and still be
 * read as a card, in logical units: room for the unit a build loses insetting a
 * stroke, on a footprint `table/card-size` grades.
 */
const CARD_SIZE_TOLERANCE = 2;

/**
 * How far a card's edge may sit from a fixed figure and still be read as sitting
 * on it, in logical units.
 *
 * The same allowance, applied to the corner. `TABLEAU_Y` (`180`) is a whole
 * number and `specs/table.md` fixes no rounding, so a conformant build has
 * nothing to round here; two units is room for a stroke traced down its
 * centre-line, and it is far under the `16` units between the end of the top
 * row's rectangles and the start of the columns'.
 */
const PLACEMENT_TOLERANCE = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts the column's first card at 180", async () => {
  await openTable(h);
  await poseColumn(h, COLUMN, columnOfCards(CARDS));

  const calls = await h.frameCalls();
  await captureStill(h, "column");

  const anchor = COLUMN_X[COLUMN];
  const drawn = cardFootprints(calls, CARD_SIZE_TOLERANCE).filter(
    (corner) => Math.abs(corner.x - anchor) <= PLACEMENT_TOLERANCE,
  );

  assertGreaterThan(
    drawn.length,
    0,
    `card-sized shapes drawn with their left edge at column ${COLUMN}'s ` +
      `anchor ${anchor}, where the one card this scenario posed sits; no other ` +
      "pile is anchored on that x (specs/table.md)",
  );

  const offAnchor = drawn.filter(
    (corner) => Math.abs(corner.y - TABLEAU_Y) > PLACEMENT_TOLERANCE,
  );
  assertDeepEqual(
    offAnchor.map((corner) => Math.round(corner.y)),
    [],
    `the top edges of the card-sized shapes column ${COLUMN} drew away from ` +
      `TABLEAU_Y (${TABLEAU_Y}), which is where a column's first card begins ` +
      "(specs/table.md)",
  );
});
