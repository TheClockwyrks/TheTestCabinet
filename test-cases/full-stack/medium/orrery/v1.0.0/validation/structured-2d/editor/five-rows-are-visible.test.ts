// editor/five-rows-are-visible — the panel shows `TAPE_ROWS_VISIBLE` rows at once,
// and no sixth.
//
// THE RULE, from `specs/editor.md` (The tape panel). `TAPE_ROWS_VISIBLE` is `5`,
// "Rows shown at once", and the geometry says which five: "Visible row `v`, from
// `0` to `4`, spans `y` `TAPE_Y0 + v * TAPE_ROW_H` to `TAPE_Y0 + (v + 1) *
// TAPE_ROW_H` and shows the arm at index `firstRow + v` in placement order" —
// `v` from `0` to `4` and no further. The band from `TAPE_Y0 + 5 * TAPE_ROW_H`
// (`700`) down to the panel's bottom edge at `STAGE_H` (`720`) is inside the panel
// and belongs to no visible row, so a press there is one of those "in the panel
// that lands on no row or cell", which "leaves the cursor as it is".
//
// THE CONFIGURATION. `BARE` opened in the editor, the machine cleared, and SIX
// arms placed one at a time through the surface along `r` `0`, from `(-5, 0)` to
// `(0, 0)`. Six is one more than the panel shows, so a build that showed six rows
// has a sixth arm to put in the band at `y` `700` and is caught there. Every press
// lands at `x` `TRAY_REGION_W + TAPE_X0` (`312`), the first unit of visible column
// `0`.
//
// TWO PRESSES, both with `firstRow` `0` — the first with the cursor cleared, where
// "`firstRow` ... [is] `0` with no cursor", and the second with the cursor on the
// FIRST arm, where `firstRow = max(0, 0 - 4)` is `0` as well:
//
// - at `y` `TAPE_Y0 + 4 * TAPE_ROW_H` (`672`), inside visible row `4`, the fifth
//   the panel shows: it must point at the arm at index `0 + 4`, the FIFTH arm.
// - at `y` `TAPE_Y0 + 5 * TAPE_ROW_H` (`700`), one row further down: it must leave
//   the posed cursor exactly as it stands, because there is no visible row `5`.
//
// THE VERDICT. Five rows are reachable and a sixth is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import {
  TAPE_ROWS_VISIBLE,
  TAPE_ROW_H,
  TAPE_X0,
  TAPE_Y0,
  TRAY_REGION_W,
} from "../constants";
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

/** Six anchors along `r` `0`, one more arm than the panel shows rows. */
const ANCHORS = [
  at(-5, 0),
  at(-4, 0),
  at(-3, 0),
  at(-2, 0),
  at(-1, 0),
  at(0, 0),
];

/** The first unit of visible column 0, so a press lands inside a cell rectangle. */
const COLUMN_X = TRAY_REGION_W + TAPE_X0;

/** The column the cursor is posed at for the second press, to be read back unchanged. */
const POSED_COL = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reaches the fifth row and finds no sixth", async () => {
  await openChallengeDocument(h, BARE);
  const arms: number[] = [];
  for (const anchor of ANCHORS) arms.push(await placePart(h, "arm", anchor));
  assertLength(
    (await h.snapshot()).editor.parts,
    6,
    "six arms stand in placement order, one more than the panel shows",
  );

  await h.debug.setCursor(null, 0);
  await h.advance(1);
  await captureStill(h, "rows");

  await pressAt(h, {
    x: COLUMN_X,
    y: TAPE_Y0 + (TAPE_ROWS_VISIBLE - 1) * TAPE_ROW_H,
  });
  await releasePointer(h);
  const fifth = (await h.snapshot()).editor.cursor;
  assertNotNull(fifth, "the press in visible row 4 lands inside a cell");
  assertEqual(
    fifth?.part,
    arms[TAPE_ROWS_VISIBLE - 1],
    "with the cursor cleared firstRow is 0, so visible row 4 shows the fifth arm",
  );

  await h.debug.setCursor(arms[0] ?? -1, POSED_COL);
  await pressAt(h, {
    x: COLUMN_X,
    y: TAPE_Y0 + TAPE_ROWS_VISIBLE * TAPE_ROW_H,
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
    "y 700 is past the fifth row, so it lands on no row and leaves the cursor as it stands",
  );
  assertEqual(
    beyond?.col,
    POSED_COL,
    "a press that lands on no row or cell leaves the cursor as it is, column included",
  );
});
