// editor/columns-rest-at-zero-with-no-cursor — with no cursor the panel rests on
// the first column.
//
// THE RULE. "`firstCol = max(0, cursor.col - (TAPE_COLS_VISIBLE - 1))`, and `0`
// with no cursor" (`specs/editor.md`, The tape panel). The trailing clause is this
// item's: with `editor.cursor` `null` there is no `cursor.col` to subtract from,
// and `firstCol` is `0`.
//
// HOW A SCROLL POSITION IS READ. "Visible column `u` spans `x` `TRAY_REGION_W +
// TAPE_X0 + u * TAPE_CELL_W` onward and shows cell `firstCol + u`", and "A press
// inside a cell rectangle points the cursor at that row's arm and that column". So
// the column a press at visible column `u` lands the cursor on is `firstCol + u`,
// and reading the cursor back after such a press reads `firstCol`.
//
// THE CONFIGURATION. `BARE` opened in the editor with ONE arm and nothing else, so
// the panel has exactly one row and every press below lands on it — `firstRow` is
// `0` with no cursor, so visible row `0` is that arm's row. `setCursor(null, 0)`
// clears the cursor, which is the operation `specs/instrumentation.md` gives for
// it: "A `part` of `null` clears the cursor."
//
// TWO PRESSES, NOT ONE. The press at visible column `0` is the item's own, and a
// build that ignored which column a press landed in would pass it by answering
// column `0` to everything. So visible column `7` is pressed as well, from the same
// cleared cursor, where `firstCol` `0` puts cell `7`.
//
// THE VERDICT. From a cleared cursor, a press at visible column `0` points the
// cursor at column `0`, and a press at visible column `7` at column `7`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
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

/** The first visible column pressed, well inside the forty on show. */
const FAR_COLUMN = 7;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows cell u at visible column u while the cursor is null", async () => {
  await openChallengeDocument(h, BARE);
  await placePart(h, "arm", ORIGIN);

  await h.debug.setCursor(null, 0);
  const clearedFirst = (await h.snapshot()).editor.cursor;
  await pressAt(h, regionCenter(tapeCell(0, 0)));
  await h.advance(1);
  await captureStill(h, "left");
  const atLeft = (await h.snapshot()).editor.cursor;
  await releasePointer(h);

  await h.debug.setCursor(null, 0);
  const clearedAgain = (await h.snapshot()).editor.cursor;
  await pressAt(h, regionCenter(tapeCell(0, FAR_COLUMN)));
  await h.advance(1);
  const atFar = (await h.snapshot()).editor.cursor;
  await releasePointer(h);

  assertNull(
    clearedFirst,
    "the cursor is cleared before the first press, so firstCol is the no-cursor case",
  );
  assertNotNull(
    atLeft,
    "the press inside a cell rectangle points the cursor at that column",
  );
  assertEqual(
    atLeft?.col,
    0,
    "firstCol is 0 with no cursor, so visible column 0 shows cell 0",
  );

  assertNull(
    clearedAgain,
    "the cursor is cleared again, so the second press is made from the same state",
  );
  assertNotNull(atFar, "the second press points the cursor at its column too");
  assertEqual(
    atFar?.col,
    FAR_COLUMN,
    `firstCol is 0 with no cursor, so visible column ${FAR_COLUMN} shows cell ${FAR_COLUMN}`,
  );
});
