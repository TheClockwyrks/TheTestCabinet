// editor/rows-are-tape-row-h-tall — a visible row is `TAPE_ROW_H` tall, so
// consecutive rows are `28` units apart.
//
// THE RULE, from `specs/editor.md` (The tape panel). "Visible row `v`, from `0` to
// `4`, spans `y` `TAPE_Y0 + v * TAPE_ROW_H` to `TAPE_Y0 + (v + 1) * TAPE_ROW_H`
// and shows the arm at index `firstRow + v` in placement order", with `TAPE_ROW_H`
// `28` tabulated as "Height of a row". Every rectangle this file fixes "includes
// its lower bound and excludes its upper", so the unit at `TAPE_Y0 + v *
// TAPE_ROW_H` belongs to row `v` and the unit one above it belongs to row `v - 1`.
// That pair of readings is the height.
//
// THE SCROLL IS POSED NON-ZERO so the rule is read whole. `firstRow = max(0,
// selectedRow - (TAPE_ROWS_VISIBLE - 1))`, so with the cursor on the SIXTH arm —
// index `5` — `firstRow` is `1`, and a press in visible row `v` must answer the
// arm at index `1 + v` rather than `v`.
//
// THE CONFIGURATION. `BARE` opened in the editor, the machine cleared, and SIX
// arms placed one at a time through the surface along `r` `0`, from `(-5, 0)` to
// `(0, 0)`. Six rows is more than the five the panel shows, which is what lets
// `firstRow` be anything but `0`. Every press lands at `x` `TRAY_REGION_W +
// TAPE_X0` (`312`), the first unit of visible column `0`, so each is inside a cell
// rectangle and points the cursor at a row.
//
// TWO BOUNDARIES ARE WALKED, at `v` `1` and at `v` `3`, each read from both sides:
// `y` `560 + v * 28` and `y` `560 + v * 28 - 1`. The cursor is re-posed before
// every press, so each is read against the same `firstRow`.
//
// THE VERDICT. Each press at `560 + v * 28` points the cursor at the arm at index
// `firstRow + v`, and each press one unit above at the arm at index
// `firstRow + v - 1`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { TAPE_ROW_H, TAPE_X0, TAPE_Y0, TRAY_REGION_W } from "../constants";
import { at } from "../field";
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

/** The first unit of visible column 0, so every press lands inside a cell. */
const COLUMN_X = TRAY_REGION_W + TAPE_X0;

/** The cursor is posed on the sixth arm, whose `firstRow` is `max(0, 5 - 4)` = 1. */
const FIRST_ROW = 1;

/** The visible rows whose top boundary is read from both sides. */
const ROWS: readonly number[] = [1, 3];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts the boundary between two rows exactly TAPE_ROW_H apart", async () => {
  await openChallengeDocument(h, BARE);
  const arms: number[] = [];
  for (const anchor of ANCHORS) arms.push(await placePart(h, "arm", anchor));
  assertLength(
    (await h.snapshot()).editor.parts,
    6,
    "six arms stand in placement order, so firstRow can be 1",
  );

  await h.debug.setCursor(arms[5] ?? -1, 0);
  await h.advance(1);
  await captureStill(h, "rows");

  for (const v of ROWS) {
    const edge = TAPE_Y0 + v * TAPE_ROW_H;

    await h.debug.setCursor(arms[5] ?? -1, 0);
    await pressAt(h, { x: COLUMN_X, y: edge });
    await releasePointer(h);
    const on = (await h.snapshot()).editor.cursor;
    assertNotNull(on, `the press at y ${edge} lands inside a cell`);
    assertEqual(
      on?.part,
      arms[FIRST_ROW + v],
      `y ${edge} is the first unit of visible row ${v}, which shows the arm at index firstRow + ${v}`,
    );

    await h.debug.setCursor(arms[5] ?? -1, 0);
    await pressAt(h, { x: COLUMN_X, y: edge - 1 });
    await releasePointer(h);
    const above = (await h.snapshot()).editor.cursor;
    assertNotNull(above, `the press at y ${edge - 1} lands inside a cell`);
    assertEqual(
      above?.part,
      arms[FIRST_ROW + v - 1],
      `y ${edge - 1} is one unit above that boundary, so it is still visible row ${v - 1}, showing the arm at index firstRow + ${v - 1}`,
    );
  }
});
