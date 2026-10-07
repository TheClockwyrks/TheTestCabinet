// editor/columns-begin-at-the-fixed-offset — cell column `0` begins at
// `TRAY_REGION_W + TAPE_X0`, and the gap before it is on no cell.
//
// THE RULE, from `specs/editor.md` (The tape panel). "A row's label spans `x`
// `TRAY_REGION_W` (`224`) to `TRAY_REGION_W + TAPE_LABEL_W` (`304`) across its
// row's full height, and the columns begin at `TRAY_REGION_W + TAPE_X0` (`312`)."
// So visible column `0` spans "`x` `TRAY_REGION_W + TAPE_X0 + u * TAPE_CELL_W`
// onward" with `u` `0`, and it shows "cell `firstCol + u`" — cell `firstCol`.
// Between `304` and `312` lies neither a label nor a column, and for a press
// there the file's last targeting sentence applies: "a press in the panel that
// lands on no row or cell leaves the cursor as it is." Every rectangle here
// "includes its lower bound and excludes its upper", so `312` is inside the first
// column and `311` is not.
//
// THE SCROLL IS POSED NON-ZERO, so the first press decides the whole rule rather
// than half of it: with the cursor at column `45`, `firstCol = max(0, 45 -
// (TAPE_COLS_VISIBLE - 1))` is `6`, so a press at `x` `312` must answer column
// `6` — the column the panel is scrolled to — and not `0`.
//
// THE CONFIGURATION. `BARE` opened in the editor, the machine cleared, and three
// arms placed one at a time through the surface, on `(-3, 0)`, `(0, 0)` and
// `(3, 0)`. Three rows is fewer than the five the panel shows, so `firstRow` is
// `0` throughout and visible row `0` is the first arm. The cursor is posed at the
// SECOND arm, column `45`, before each press, so the press either moves it — to
// the first arm, at some column — or leaves it exactly there, and the two answers
// cannot be confused.
//
// THE VERDICT. The press at `x` `312` points the cursor at the first arm, column
// `firstCol` (`6`). The press at `x` `311`, one unit to its left and on the same
// row, leaves the cursor exactly where it was posed: it landed on no row or cell.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { TAPE_ROW_H, TAPE_X0, TAPE_Y0, TRAY_REGION_W } from "../constants";
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

/** The stage `x` the columns begin at, and the unit before it. */
const COLUMNS_X0 = TRAY_REGION_W + TAPE_X0;
const BEFORE_X0 = COLUMNS_X0 - 1;

/** The middle of visible row 0, vertically, so neither press depends on a row edge. */
const ROW_Y = TAPE_Y0 + TAPE_ROW_H / 2;

/** The column the cursor is posed at, whose `firstCol` is `max(0, 45 - 39)` = 6. */
const POSED_COL = 45;
const FIRST_COL = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("targets column firstCol at x 312 and nothing at x 311", async () => {
  await openChallengeDocument(h, BARE);
  const arms = [
    await placePart(h, "arm", WEST),
    await placePart(h, "arm", ORIGIN),
    await placePart(h, "arm", EAST),
  ];

  await h.debug.setCursor(arms[1] ?? -1, POSED_COL);
  await h.advance(1);
  await captureStill(h, "edges");

  await pressAt(h, { x: COLUMNS_X0, y: ROW_Y });
  await releasePointer(h);
  const inside = (await h.snapshot()).editor.cursor;
  assertNotNull(
    inside,
    "the press at x 312 lands inside the first visible column",
  );
  assertEqual(
    inside?.part,
    arms[0],
    "the press lands in visible row 0, which shows the first arm",
  );
  assertEqual(
    inside?.col,
    FIRST_COL,
    "the columns begin at TRAY_REGION_W + TAPE_X0, so x 312 is visible column 0, which shows cell firstCol",
  );

  await h.debug.setCursor(arms[1] ?? -1, POSED_COL);
  await pressAt(h, { x: BEFORE_X0, y: ROW_Y });
  await releasePointer(h);
  const outside = (await h.snapshot()).editor.cursor;
  assertNotNull(
    outside,
    "the cursor is still pointed somewhere after the press",
  );
  assertEqual(
    outside?.part,
    arms[1],
    "x 311 lies between the label and the first column, on no row or cell, so the cursor stands as it was",
  );
  assertEqual(
    outside?.col,
    POSED_COL,
    "a press that lands on no row or cell leaves the cursor as it is, column included",
  );
});
