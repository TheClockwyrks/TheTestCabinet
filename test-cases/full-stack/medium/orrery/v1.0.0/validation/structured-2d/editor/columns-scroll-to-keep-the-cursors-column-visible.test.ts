// editor/columns-scroll-to-keep-the-cursors-column-visible — once the cursor's
// column is past the fortieth, the panel scrolls exactly far enough to hold it.
//
// THE RULE. "`firstCol = max(0, cursor.col - (TAPE_COLS_VISIBLE - 1))`, and `0`
// with no cursor" (`specs/editor.md`, The tape panel), with `TAPE_COLS_VISIBLE`
// `40`. With the cursor at column `50`, that is `max(0, 50 - 39)` = `11`. Because
// `firstCol` is `cursor.col` minus the last visible column's offset, the cursor's
// own column lands on the RIGHTMOST visible one: `firstCol + 39` = `50`.
//
// HOW A SCROLL POSITION IS READ. "Visible column `u` spans `x` `TRAY_REGION_W +
// TAPE_X0 + u * TAPE_CELL_W` onward and shows cell `firstCol + u`", and "A press
// inside a cell rectangle points the cursor at that row's arm and that column". So
// the column a press at visible column `u` lands the cursor on is `firstCol + u`,
// and reading the cursor back after such a press reads `firstCol`.
//
// THE CONFIGURATION. `BARE` opened in the editor with ONE arm and nothing else, so
// the panel has exactly one row and every press below lands on it whatever the row
// scroll does — `firstRow` is `max(0, 0 - 4)` = `0` throughout, so visible row `0`
// is that arm's row. The cursor is posed at column `50` of it. Nothing is written
// on the tape: a cursor may stand past a tape's last cell, since "A tape has no
// fixed end", and the scroll rule is computed from `cursor.col` alone.
//
// TWO PRESSES, ONE PER HALF OF THE RULE. The press at visible column `0` reads
// `firstCol` itself, which must be `11`; the press at visible column `39` reads
// where the cursor's own column sits, which must be `50`. A build that never
// scrolled would answer `0` and `39`, and one that scrolled by `cursor.col` would
// answer `50` and `89`. The cursor is posed again between the two, because the
// first press moved it.
//
// THE VERDICT. A press at visible column `0` points the cursor at column `11`, and a
// press at visible column `39` at column `50`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { TAPE_COLS_VISIBLE } from "../constants";
import { regionCenter, tapeCell } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  placePart,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

/** The column the cursor is posed at: 50, which is past the first forty. */
const CURSOR_COLUMN = 50;

/** `max(0, 50 - 39)`, the scroll the rule derives from it. */
const FIRST_COL = CURSOR_COLUMN - (TAPE_COLS_VISIBLE - 1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts firstCol at 11 and the cursor's column on the rightmost visible one", async () => {
  await openChallengeDocument(h, BARE);
  const arm = await placePart(h, "arm", ORIGIN);

  await h.debug.setCursor(arm, CURSOR_COLUMN);
  await pressAt(h, regionCenter(tapeCell(0, 0)));
  await h.advance(1);
  await captureStill(h, "scrolled");
  const atLeft = (await h.snapshot()).editor.cursor;
  await releasePointer(h);

  assertNotNull(
    atLeft,
    "the press inside a cell rectangle points the cursor at that column",
  );
  assertEqual(
    atLeft?.col,
    FIRST_COL,
    `firstCol is max(0, ${CURSOR_COLUMN} - 39), which is ${FIRST_COL}, so visible column 0 shows cell ${FIRST_COL}`,
  );

  await h.debug.setCursor(arm, CURSOR_COLUMN);
  await pressAt(h, regionCenter(tapeCell(0, TAPE_COLS_VISIBLE - 1)));
  await h.advance(1);
  const atRight = (await h.snapshot()).editor.cursor;
  await releasePointer(h);

  assertNotNull(
    atRight,
    "the second press points the cursor at its column too",
  );
  assertEqual(
    atRight?.col,
    CURSOR_COLUMN,
    `firstCol + 39 is ${CURSOR_COLUMN}, so the cursor's own column is the rightmost visible one`,
  );
});
