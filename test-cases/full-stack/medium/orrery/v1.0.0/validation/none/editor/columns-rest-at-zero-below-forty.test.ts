// editor/columns-rest-at-zero-below-forty — the panel does not scroll sideways
// while the cursor's column is one of the first forty.
//
// THE RULE. "`firstCol = max(0, cursor.col - (TAPE_COLS_VISIBLE - 1))`, and `0`
// with no cursor" (`specs/editor.md`, The tape panel), with `TAPE_COLS_VISIBLE`
// `40`. With the cursor at column `10`, that is `max(0, 10 - 39)` = `max(0, -29)` =
// `0`.
//
// HOW A SCROLL POSITION IS READ. The same section makes the visible columns the
// observable: "Visible column `u` spans `x` `TRAY_REGION_W + TAPE_X0 + u *
// TAPE_CELL_W` onward and shows cell `firstCol + u`", and "A press inside a cell
// rectangle points the cursor at that row's arm and that column". So the column a
// press at visible column `u` lands the cursor on is `firstCol + u`, and reading
// the cursor back after such a press reads `firstCol`.
//
// THE CONFIGURATION. `BARE` opened in the editor with ONE arm and nothing else, so
// the panel has exactly one row and every press below lands on it whatever the row
// scroll does — `firstRow` is `max(0, 0 - 4)` = `0` throughout, so visible row `0`
// is that arm's row. The cursor is posed at column `10` of it.
//
// TWO PRESSES, NOT ONE. A press at visible column `0` alone is satisfied by a build
// that answers column `0` to every press. So visible column `20` is pressed as
// well, from the same posed cursor, where `firstCol` `0` puts cell `20`. A build
// that scrolled by `cursor.col` rather than by `max(0, cursor.col - 39)` would
// answer `10` and `30`. The cursor is posed again between the two, because the
// first press moved it.
//
// THE VERDICT. A press at visible column `0` points the cursor at column `0`, and a
// press at visible column `20` at column `20`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
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

/** The column the cursor is posed at: 10, which is within the first forty. */
const CURSOR_COLUMN = 10;

/** The second visible column pressed, well inside the forty on show. */
const FAR_COLUMN = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves firstCol at 0 with the cursor at column 10", async () => {
  await openChallengeDocument(h, BARE);
  const arm = await placePart(h, "arm", ORIGIN);

  await h.debug.setCursor(arm, CURSOR_COLUMN);
  await pressAt(h, regionCenter(tapeCell(0, 0)));
  await h.advance(1);
  await captureStill(h, "unscrolled");
  const atLeft = (await h.snapshot()).editor.cursor;
  await releasePointer(h);

  assertNotNull(
    atLeft,
    "the press inside a cell rectangle points the cursor at that column",
  );
  assertEqual(
    atLeft?.col,
    0,
    "firstCol is max(0, 10 - 39), which is 0, so visible column 0 shows cell 0",
  );

  await h.debug.setCursor(arm, CURSOR_COLUMN);
  await pressAt(h, regionCenter(tapeCell(0, FAR_COLUMN)));
  await h.advance(1);
  const atFar = (await h.snapshot()).editor.cursor;
  await releasePointer(h);

  assertNotNull(atFar, "the second press points the cursor at its column too");
  assertEqual(
    atFar?.col,
    FAR_COLUMN,
    `visible column u shows cell firstCol + u, and firstCol is 0, so visible column ${FAR_COLUMN} shows cell ${FAR_COLUMN}`,
  );
});
