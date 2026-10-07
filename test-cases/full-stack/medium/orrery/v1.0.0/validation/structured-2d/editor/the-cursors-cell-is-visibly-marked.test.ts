// editor/the-cursors-cell-is-visibly-marked — the cell the cursor stands on is
// drawn differently from the way the same cell is drawn without it.
//
// THE RULE. "The cursor's cell is visibly marked" (`specs/editor.md`, The tape
// panel). How it is marked is the build's; that it is visible is the requirement,
// and what a player reads it for is where the next write lands — "Each instruction
// action writes its instruction at the cursor".
//
// HOW IT IS READ. One cell rectangle, drawn twice: once with the cursor on it, and
// once with the cursor moved a single column away and everything else in the world
// left exactly as it was. A mark that is visible makes those two pictures differ.
//
// THE CONFIGURATION. `BARE` opened in the editor with ONE arm and nothing else, so
// the panel has exactly one row and `firstRow` is `0`. Its tape carries `grab` at
// column `8` and nothing else, which makes the tape's length `9`, so both columns
// the cursor visits are ordinary blank cells INSIDE the tape rather than columns
// past its end. The cursor is posed at column `3` and then at column `4`, and
// `firstCol` is `max(0, 3 - 39)` = `0` for the first and `max(0, 4 - 39)` = `0` for
// the second, so the panel does not scroll between the two frames and visible
// column `3` is cell `3` in both. Nothing else changes: the same machine, the same
// tape, the same focus.
//
// THE VERDICT. The rectangle of visible column `3` is not the same picture with the
// cursor on it as with the cursor one column away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNotNull } from "../assert";
import { tapeCell } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  pixelsDiffering,
  placePart,
  type Harness,
  type PixelRect,
} from "../harness";

/** The column read: the cursor stands on it in the first frame and not the second. */
const READ_COLUMN = 3;

/** The column the cursor is moved to, one to the right of the one read. */
const AWAY_COLUMN = 4;

/** A written cell far to the right, so the two columns read lie inside the tape. */
const TAPE_END_COLUMN = 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

function readCell(u: number): Promise<PixelRect> {
  const cell = tapeCell(0, u);
  return h.pixelRect(cell.x, cell.y, cell.w, cell.h);
}

it("draws the cursor's cell differently from the same cell without the cursor", async () => {
  await openChallengeDocument(h, BARE);
  const arm = await placePart(h, "arm", ORIGIN);
  await h.debug.setTapeCell(arm, TAPE_END_COLUMN, "grab");

  await h.debug.setCursor(arm, READ_COLUMN);
  await h.advance(1);
  await captureStill(h, "marked");
  const onIt = await readCell(READ_COLUMN);
  const posed = (await h.snapshot()).editor.cursor;

  await h.debug.setCursor(arm, AWAY_COLUMN);
  await h.advance(1);
  const away = await readCell(READ_COLUMN);
  const moved = (await h.snapshot()).editor.cursor;

  assertNotNull(
    posed,
    "the cursor stands on the column read in the first frame",
  );
  assertEqual(
    posed?.col,
    READ_COLUMN,
    `the cursor is on column ${READ_COLUMN} for the first frame`,
  );
  assertNotNull(
    moved,
    "the cursor still exists in the second frame, one column away",
  );
  assertEqual(
    moved?.col,
    AWAY_COLUMN,
    `the cursor is on column ${AWAY_COLUMN} for the second frame`,
  );

  assertGreaterThan(
    pixelsDiffering(onIt, away),
    0,
    `the cursor's cell is visibly marked, so column ${READ_COLUMN} is not drawn the same with the cursor on it as with the cursor on column ${AWAY_COLUMN}`,
  );
});
