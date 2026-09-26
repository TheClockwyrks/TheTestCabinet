// editor/a-press-on-no-row-or-cell-leaves-the-cursor — a press inside the tape
// panel that falls on no row and no cell leaves the cursor exactly where it stood.
//
// THE RULE. "A press inside a cell rectangle points the cursor at that row's arm
// and that column; a press inside a row's label points it at that row, column `0`;
// a press in the panel that lands on no row or cell leaves the cursor as it is"
// (`specs/editor.md`, The tape panel). The third clause is this item's: the cursor
// is neither cleared nor dragged to a nearby row.
//
// WHERE SUCH A PRESS LANDS. The panel is "`x` `TRAY_REGION_W` (`224`) to `STAGE_W`
// (`1280`), `y` `TAPE_Y0` (`560`) to `STAGE_H` (`720`)" — `160` units tall — while
// "Visible row `v`, from `0` to `4`, spans `y` `TAPE_Y0 + v * TAPE_ROW_H` to
// `TAPE_Y0 + (v + 1) * TAPE_ROW_H`" with `TAPE_ROW_H` `28`, so the five rows cover
// `560` to `700` and the strip from `700` to `720` is inside the panel and inside
// no row at all. And a visible row "shows the arm at index `firstRow + v` in
// placement order", so with two arms placed and `firstRow` `0`, visible row `3`
// shows no arm: its rectangles are a row of the panel with no row of the machine
// behind them. Both presses below are made, one of each kind.
//
// THE CONFIGURATION. `BARE` opened in the editor with two arms and nothing else,
// the cursor posed at column `7` of the FIRST arm's row. `firstRow` is
// `max(0, 0 - 4)` = `0` and `firstCol` is `max(0, 7 - 39)` = `0`, so the panel is
// unscrolled on both axes and the two press points are exactly the ones computed
// above. Column `7` rather than column `0`, and the first row rather than the last,
// so a build that moved the cursor anywhere at all is caught.
//
// THE PRESS REALLY REACHED THE GAME. Each press is made with the REAL pointer,
// through the frame that delivers it, and `specs/controls.md`: "`state.pointer`
// mirrors the pointer's position and press state ... Each pointer sample the game
// reads moves it", so `pointer` is read back at the point pressed, with `down`
// set. A build that never saw the press would leave the cursor alone too, and
// that reading is what tells the two apart.
//
// THE VERDICT. After each press `editor.cursor` still names the first arm and
// column `7`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertTrue } from "../assert";
import {
  TAPE_ROWS_VISIBLE,
  TAPE_ROW_H,
  TAPE_Y0,
  STAGE_H,
  STAGE_W,
  TRAY_REGION_W,
} from "../constants";
import { at, regionCenter, tapeCell, type StagePoint } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  placePart,
  type Harness,
} from "../harness";

/** The two anchors the two arms stand on, six hexes apart and both on the field. */
const FIRST = at(-3, 0);
const SECOND = at(3, 0);

/** The column the cursor is posed at, well inside the forty visible ones. */
const COLUMN = 7;

/** Visible row 3, which with two arms placed and firstRow 0 shows no arm. */
const NO_ROW: StagePoint = regionCenter(tapeCell(3, 2));

/** The strip below every row: y 700 to 720, inside the panel and inside no row. */
const BELOW_THE_ROWS: StagePoint = {
  x: (TRAY_REGION_W + STAGE_W) / 2,
  y: (TAPE_Y0 + TAPE_ROWS_VISIBLE * TAPE_ROW_H + STAGE_H) / 2,
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Press the real pointer at a point, through the frame that mirrors it. */
async function pressAndRead(where: StagePoint): Promise<void> {
  await h.mousePress(where.x, where.y);
  const pointer = (await h.snapshot()).pointer;
  assertEqual(
    pointer.x,
    where.x,
    "the pointer mirrors the x the press was made at",
  );
  assertEqual(
    pointer.y,
    where.y,
    "the pointer mirrors the y the press was made at",
  );
  assertTrue(
    pointer.down,
    "the pointer mirrors the press as down, so the game saw it",
  );
}

it("leaves the cursor as it stands when a panel press lands on no row or cell", async () => {
  await openChallengeDocument(h, BARE);
  const first = await placePart(h, "arm", FIRST);
  await placePart(h, "arm", SECOND);
  await h.debug.setCursor(first, COLUMN);

  const posed = (await h.snapshot()).editor.cursor;
  assertNotNull(
    posed,
    "the cursor is posed before either press, so it has something to hold",
  );
  assertEqual(posed?.part, first, "the cursor is posed on the first arm's row");
  assertEqual(posed?.col, COLUMN, `the cursor is posed at column ${COLUMN}`);

  await pressAndRead(NO_ROW);
  await captureStill(h, "held");
  const afterNoRow = (await h.snapshot()).editor.cursor;
  await h.mouseRelease();

  assertNotNull(
    afterNoRow,
    "a press on visible row 3, which shows no arm, does not clear the cursor",
  );
  assertEqual(
    afterNoRow?.part,
    first,
    "the press landed on no row, so the cursor still names the first arm rather than a nearby row",
  );
  assertEqual(
    afterNoRow?.col,
    COLUMN,
    `the press landed on no cell, so the cursor still stands at column ${COLUMN}`,
  );

  await pressAndRead(BELOW_THE_ROWS);
  const afterStrip = (await h.snapshot()).editor.cursor;
  await h.mouseRelease();

  assertNotNull(
    afterStrip,
    "a press in the panel below every row does not clear the cursor either",
  );
  assertEqual(
    afterStrip?.part,
    first,
    "the strip below the five rows is no row, so the cursor still names the first arm",
  );
  assertEqual(
    afterStrip?.col,
    COLUMN,
    `the strip below the five rows is no cell, so the cursor still stands at column ${COLUMN}`,
  );
});
