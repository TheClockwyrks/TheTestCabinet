// editor/forty-columns-are-visible — the panel shows `TAPE_COLS_VISIBLE` columns
// at once, and no forty-first.
//
// THE RULE, from `specs/editor.md` (The tape panel). `TAPE_COLS_VISIBLE` is `40`,
// "Cell columns shown at once", and "Visible column `u` spans `x` `TRAY_REGION_W +
// TAPE_X0 + u * TAPE_CELL_W` onward and shows cell `firstCol + u`". Forty columns
// starting at `312` and `24` wide reach to `312 + 40 * 24` (`1272`), and the panel
// itself runs to `STAGE_W` (`1280`), so the band from `1272` to `1280` is inside
// the panel and belongs to no visible column: a press there is one "in the panel
// that lands on no row or cell", which "leaves the cursor as it is".
//
// THE CONFIGURATION. `BARE` opened in the editor, the machine cleared, and three
// arms placed one at a time through the surface, on `(-3, 0)`, `(0, 0)` and
// `(3, 0)`. Three rows is fewer than the five the panel shows, so `firstRow` is
// `0` throughout and every press lands in visible row `0`, at the vertical middle
// of that row so nothing depends on a row edge.
//
// BOTH PRESSES ARE MADE WITH `firstCol` `0` — the first with the cursor cleared,
// where "`firstCol` ... [is] `0` with no cursor", and the second with the cursor
// at column `5`, where `firstCol = max(0, 5 - 39)` is `0` as well — so the column
// a press answers is its visible column outright:
//
// - at `x` `312 + 39 * 24` (`1248`), inside visible column `39`, the fortieth the
//   panel shows: it must point at cell `0 + 39`.
// - at `x` `312 + 40 * 24` (`1272`), one column further right: it must leave the
//   posed cursor exactly as it stands, because there is no visible column `40`.
//
// THE VERDICT. Forty columns are reachable and a forty-first is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import {
  TAPE_CELL_W,
  TAPE_COLS_VISIBLE,
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

/** The column the cursor is posed at for the second press, to be read back unchanged. */
const POSED_COL = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reaches the fortieth column and finds no forty-first", async () => {
  await openChallengeDocument(h, BARE);
  const arms = [
    await placePart(h, "arm", WEST),
    await placePart(h, "arm", ORIGIN),
    await placePart(h, "arm", EAST),
  ];

  await h.debug.setCursor(null, 0);
  await h.advance(1);
  await captureStill(h, "columns");

  await pressAt(h, {
    x: COLUMNS_X0 + (TAPE_COLS_VISIBLE - 1) * TAPE_CELL_W,
    y: ROW_Y,
  });
  await releasePointer(h);
  const fortieth = (await h.snapshot()).editor.cursor;
  assertNotNull(fortieth, "the press in visible column 39 lands inside a cell");
  assertEqual(
    fortieth?.part,
    arms[0],
    "the press lands in visible row 0, which shows the first arm",
  );
  assertEqual(
    fortieth?.col,
    TAPE_COLS_VISIBLE - 1,
    "with the cursor cleared firstCol is 0, so visible column 39 shows cell 39",
  );

  await h.debug.setCursor(arms[0] ?? -1, POSED_COL);
  await pressAt(h, {
    x: COLUMNS_X0 + TAPE_COLS_VISIBLE * TAPE_CELL_W,
    y: ROW_Y,
  });
  await releasePointer(h);
  const beyond = (await h.snapshot()).editor.cursor;
  assertNotNull(
    beyond,
    "the cursor is still pointed somewhere after the press",
  );
  assertEqual(
    beyond?.part,
    arms[0],
    "x 1272 is past the fortieth column, so it lands on no cell and leaves the cursor as it stands",
  );
  assertEqual(
    beyond?.col,
    POSED_COL,
    "a press that lands on no row or cell leaves the cursor as it is, column included",
  );
});
