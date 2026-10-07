// editor/cells-are-tape-cell-w-wide — a cell column is `TAPE_CELL_W` wide, so
// consecutive columns are `24` units apart.
//
// THE RULE, from `specs/editor.md` (The tape panel). "Visible column `u` spans `x`
// `TRAY_REGION_W + TAPE_X0 + u * TAPE_CELL_W` onward and shows cell `firstCol +
// u`", with `TAPE_CELL_W` `24` tabulated as "Width of a cell". Every rectangle
// this file fixes "includes its lower bound and excludes its upper", so the unit
// at `TRAY_REGION_W + TAPE_X0 + u * TAPE_CELL_W` belongs to column `u` and the
// unit one to its left belongs to column `u - 1`. That pair of readings is the
// width: a build whose columns were wider or narrower than `24` puts the boundary
// somewhere else, and one of the two presses lands on the wrong column.
//
// THE SCROLL IS POSED NON-ZERO so the rule is read whole. With the cursor at
// column `45`, `firstCol = max(0, 45 - (TAPE_COLS_VISIBLE - 1))` is `6`, so a
// press in visible column `u` must answer `6 + u` rather than `u`.
//
// THE CONFIGURATION. `BARE` opened in the editor, the machine cleared, and three
// arms placed one at a time through the surface, on `(-3, 0)`, `(0, 0)` and
// `(3, 0)`. Three rows is fewer than the five the panel shows, so `firstRow` is
// `0` and every press below lands in visible row `0`, the first arm's row, at the
// vertical middle of that row so nothing depends on a row edge.
//
// TWO BOUNDARIES ARE WALKED, at `u` `1` and at `u` `3`, each read from both sides:
// `x` `312 + u * 24` and `x` `312 + u * 24 - 1`. The cursor is re-posed before
// every press, so each press is read against the same `firstCol` and answers for
// itself.
//
// THE VERDICT. Each press at `312 + u * 24` points the cursor at column
// `firstCol + u`, and each press one unit to its left at column `firstCol + u - 1`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import {
  TAPE_CELL_W,
  TAPE_ROW_H,
  TAPE_X0,
  TAPE_Y0,
  TRAY_REGION_W,
} from "../constants";
import { BARE, EAST, ORIGIN, WEST } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  placePart,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

/** The stage `x` the columns begin at, and the vertical middle of visible row 0. */
const COLUMNS_X0 = TRAY_REGION_W + TAPE_X0;
const ROW_Y = TAPE_Y0 + TAPE_ROW_H / 2;

/** The column the cursor is posed at, whose `firstCol` is `max(0, 45 - 39)` = 6. */
const POSED_COL = 45;
const FIRST_COL = 6;

/** The visible columns whose left boundary is read from both sides. */
const COLUMNS: readonly number[] = [1, 3];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts the boundary between two columns exactly TAPE_CELL_W apart", async () => {
  await openChallengeDocument(h, BARE);
  const arms = [
    await placePart(h, "arm", WEST),
    await placePart(h, "arm", ORIGIN),
    await placePart(h, "arm", EAST),
  ];

  await h.debug.setCursor(arms[1] ?? -1, POSED_COL);
  await h.advance(1);
  await captureStill(h, "columns");

  for (const u of COLUMNS) {
    const edge = COLUMNS_X0 + u * TAPE_CELL_W;

    await h.debug.setCursor(arms[1] ?? -1, POSED_COL);
    await pressAt(h, { x: edge, y: ROW_Y });
    await releasePointer(h);
    const on = (await h.snapshot()).editor.cursor;
    assertNotNull(on, `the press at x ${edge} lands inside a cell`);
    assertEqual(
      on?.part,
      arms[0],
      `the press at x ${edge} lands in visible row 0, which shows the first arm`,
    );
    assertEqual(
      on?.col,
      FIRST_COL + u,
      `x ${edge} is the first unit of visible column ${u}, which shows cell firstCol + ${u}`,
    );

    await h.debug.setCursor(arms[1] ?? -1, POSED_COL);
    await pressAt(h, { x: edge - 1, y: ROW_Y });
    await releasePointer(h);
    const before = (await h.snapshot()).editor.cursor;
    assertNotNull(before, `the press at x ${edge - 1} lands inside a cell`);
    assertEqual(
      before?.col,
      FIRST_COL + u - 1,
      `x ${edge - 1} is one unit left of that boundary, so it is still visible column ${u - 1}, showing cell firstCol + ${u - 1}`,
    );
  }
});
