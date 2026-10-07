// editor/a-cell-press-points-the-cursor-at-that-row-and-column — a press inside a
// cell rectangle points the cursor at `firstRow + v` and `firstCol + u`.
//
// THE RULE, from `specs/editor.md` (The tape panel). "A press inside a cell
// rectangle points the cursor at that row's arm and that column". Which row and
// which column those are is fixed by the geometry above it: "Visible row `v`, from
// `0` to `4`, spans `y` `TAPE_Y0 + v * TAPE_ROW_H` to `TAPE_Y0 + (v + 1) *
// TAPE_ROW_H` and shows the arm at index `firstRow + v` in placement order.
// Visible column `u` spans `x` `TRAY_REGION_W + TAPE_X0 + u * TAPE_CELL_W` onward
// and shows cell `firstCol + u`." And the two scroll positions are derived:
// "`firstRow = max(0, selectedRow - (TAPE_ROWS_VISIBLE - 1))`, where `selectedRow`
// is the cursor's arm's index in placement order, and `0` with no cursor";
// "`firstCol = max(0, cursor.col - (TAPE_COLS_VISIBLE - 1))`, and `0` with no
// cursor." `specs/instrumentation.md` reports where the cursor points as
// `editor.cursor`, `{ part, col }`.
//
// THE CONFIGURATION. `BARE` opened in the editor, the machine cleared, and SIX
// arms placed one at a time through the surface along `r` `0`, from `(-5, 0)` to
// `(0, 0)`, so `editor.parts` holds six rows in a known placement order and the
// panel — which shows five at once — cannot show them all. Nothing else is on the
// field.
//
// TWO PRESSES, POSED SO THE TWO OFFSETS ARE BOTH NON-ZERO IN ONE OF THEM. The
// cursor is posed through the surface before each press, because it is what the
// scroll is derived from:
//
// - Cursor at the SIXTH arm, column `45`: `firstRow` is `max(0, 5 - 4)` = `1` and
//   `firstCol` is `max(0, 45 - 39)` = `6`. A press in visible row `2`, column `3`
//   must point at the arm at index `1 + 2` = `3` and column `6 + 3` = `9`. A build
//   that read `v` and `u` as the row and the column outright would answer arm `2`
//   and column `3`, and is caught.
// - Cursor cleared: both scroll positions rest at `0`, and a press in visible row
//   `1`, column `2` must point at the arm at index `1` and column `2`.
//
// Each press lands in the MIDDLE of its cell's rectangle, so nothing here depends
// on which edges the rectangle includes.
//
// THE VERDICT. Each press leaves `editor.cursor` naming exactly the arm at
// `firstRow + v` and the column `firstCol + u`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { at, regionCenter, tapeCell } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  placePart,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

/** Six anchors along `r` `0`, all on the field of radius `FIELD_R` (5). */
const ANCHORS = [
  at(-5, 0),
  at(-4, 0),
  at(-3, 0),
  at(-2, 0),
  at(-1, 0),
  at(0, 0),
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("points the cursor at firstRow + v and firstCol + u", async () => {
  await openChallengeDocument(h, BARE);
  const arms: number[] = [];
  for (const anchor of ANCHORS) arms.push(await placePart(h, "arm", anchor));
  assertLength(
    (await h.snapshot()).editor.parts,
    6,
    "six arms stand in placement order, so the panel scrolls",
  );

  // A scrolled panel: firstRow 1, firstCol 6.
  await h.debug.setCursor(arms[5] ?? -1, 45);
  await h.advance(1);
  await captureStill(h, "cursor");
  await pressAt(h, regionCenter(tapeCell(2, 3)));
  await releasePointer(h);

  const scrolled = (await h.snapshot()).editor.cursor;
  assertNotNull(
    scrolled,
    "the press inside the cell rectangle points the cursor",
  );
  assertEqual(
    scrolled?.part,
    arms[3],
    "visible row 2 shows the arm at index firstRow + 2, which is 1 + 2 with the cursor on the sixth arm",
  );
  assertEqual(
    scrolled?.col,
    9,
    "visible column 3 shows cell firstCol + 3, which is 6 + 3 with the cursor at column 45",
  );

  // An unscrolled panel: firstRow 0, firstCol 0.
  await h.debug.setCursor(null, 0);
  await pressAt(h, regionCenter(tapeCell(1, 2)));
  await releasePointer(h);

  const resting = (await h.snapshot()).editor.cursor;
  assertNotNull(
    resting,
    "the press inside the cell rectangle points the cursor",
  );
  assertEqual(
    resting?.part,
    arms[1],
    "with no cursor firstRow is 0, so visible row 1 shows the arm at index 1",
  );
  assertEqual(
    resting?.col,
    2,
    "with no cursor firstCol is 0, so visible column 2 shows cell 2",
  );
});
