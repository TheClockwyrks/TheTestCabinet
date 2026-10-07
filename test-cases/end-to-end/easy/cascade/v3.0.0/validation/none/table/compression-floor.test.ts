// table/compression-floor — the compressed offset never falls below 14.
//
// THE RULE. `specs/table.md`: "The reduced offset never falls below
// `FACE_UP_OFFSET_MIN` (`14`), and a column long enough to demand less than `14`
// draws `14`." The floor beats the line: the same paragraph says a column's
// lowest card "may not fall below `COLUMN_BOTTOM_LIMIT` (`676`)", and a column
// this long cannot honour both, so the specification settles it — `14` is drawn
// and the column runs on past the line.
//
// THE POSE, AND WHY TWENTY-NINE. Column 2 — the one column anchor no top-row pile
// shares, so every card-sized shape at `x = 468` is that column's — carrying
// twenty-nine face-up cards. Twenty-eight gaps have to fit the `356` units
// between `TABLEAU_Y` and a card's height above the line, so the column DEMANDS
// `356 / 28 = 12.71` and the floor is what makes the difference. Twenty-nine is
// the longest column whose lowest card is still drawn wholly on the stage at the
// floored offset — `180 + 14 x 28 = 572`, a bottom edge of `712` inside
// `STAGE_H` — so no build can be read wrongly here for declining to draw a card
// that had left the stage.
//
// AND THE DISTINGUISHING VALUE. `12.71` against `14` is the whole point of the
// pose: a build that took the floor out of its arithmetic draws the demanded
// value, and over twenty-eight gaps that puts its lowest card `36` units higher
// than a floored one. The reading is the MEAN gap rather than one of them, which
// is the same figure measured over the whole column: `14` against `12.71` either
// way, and immune to how a build rounds an individual row.
//
// WHAT IS READ. The mean of the twenty-eight gaps, against `14`. The direction
// this point states is that the offset does not fall BELOW the floor, and the
// bound above is stated with it because a build that drew MORE than `14` here
// would not be honouring the fit at all — the column already demands less.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertLength } from "../assert";
import {
  CARD_H,
  COLUMN_BOTTOM_LIMIT,
  COLUMN_X,
  FACE_UP_OFFSET_MIN,
  STAGE_H,
  TABLEAU_Y,
} from "../constants";
import {
  captureStill,
  columnOfCards,
  columnRowTops,
  createHarness,
  openTable,
  poseColumn,
  type Harness,
} from "../harness";

/** The column posed: the one anchor no top-row pile shares (`468`). */
const COLUMN = 2;

/**
 * Twenty-nine face-up cards: enough that the fit demands `12.71`, below the
 * floor, and few enough that the lowest card is still drawn wholly on the stage
 * once the floor has been applied.
 */
const CARDS = 29;

/** What the fit demands of a column this long, which is under the floor. */
const DEMANDED = (COLUMN_BOTTOM_LIMIT - CARD_H - TABLEAU_Y) / (CARDS - 1);

/**
 * How far a painted shape's size may sit from the card footprint, and its left
 * edge from the column's anchor, to be read as one of that column's cards, in
 * logical units: room for the unit a build loses insetting a stroke, on a
 * footprint `table/card-size` grades. It stays well under `FACE_UP_OFFSET_MIN`
 * itself, so two cards of this column are never merged into one row.
 */
const CARD_SIZE_TOLERANCE = 2;

/**
 * How far the mean gap may sit from the floor, in logical units.
 *
 * The mean is `(last row - first row) / 28`, so however a build rounds the rows
 * between them the mean moves by at most a whole unit over twenty-eight — under
 * `0.04`. Half a unit is that with room to spare, and it leaves the value a build
 * without the floor would draw, `12.71`, one and a third units outside.
 */
const MEAN_GAP_TOLERANCE = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("still draws 14 when the column demands less", async () => {
  await openTable(h);
  await poseColumn(h, COLUMN, columnOfCards(CARDS));

  const calls = await h.frameCalls();
  await captureStill(h, "floored");

  const rows = columnRowTops(calls, COLUMN, CARD_SIZE_TOLERANCE);
  assertLength(
    rows,
    CARDS,
    `rows the ${CARDS} cards on column ${COLUMN} were drawn on, read as the ` +
      `distinct top edges of the card-sized shapes at x = ${COLUMN_X[COLUMN]}; ` +
      `at the floor the lowest of them reaches ${TABLEAU_Y + FACE_UP_OFFSET_MIN * (CARDS - 1)}` +
      `, a bottom edge of ${TABLEAU_Y + FACE_UP_OFFSET_MIN * (CARDS - 1) + CARD_H}` +
      ` inside the ${STAGE_H} stage (specs/table.md)`,
  );

  const mean = (rows[rows.length - 1] - rows[0]) / (CARDS - 1);
  assertBetween(
    mean,
    FACE_UP_OFFSET_MIN - MEAN_GAP_TOLERANCE,
    FACE_UP_OFFSET_MIN + MEAN_GAP_TOLERANCE,
    `the mean face-up gap of a column of ${CARDS} face-up cards, which demands ` +
      `${Math.round(DEMANDED * 100) / 100} to fit above ` +
      `COLUMN_BOTTOM_LIMIT (${COLUMN_BOTTOM_LIMIT}) and therefore draws ` +
      `FACE_UP_OFFSET_MIN (${FACE_UP_OFFSET_MIN}) instead (specs/table.md)`,
  );
});
