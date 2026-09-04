// editor/rows-scroll-to-keep-the-cursors-row-visible — once the cursor's row is
// past the fifth, the panel scrolls exactly far enough to hold it.
//
// THE RULE. "`firstRow = max(0, selectedRow - (TAPE_ROWS_VISIBLE - 1))`, where
// `selectedRow` is the cursor's arm's index in placement order, and `0` with no
// cursor" (`specs/editor.md`, The tape panel), with `TAPE_ROWS_VISIBLE` `5`. With
// the cursor on the arm at index `7`, that is `max(0, 7 - 4)` = `3`. Because
// `firstRow` is `selectedRow` minus the last visible row's offset, the cursor's own
// row lands on the BOTTOM visible row: `firstRow + 4` = `7`.
//
// HOW A SCROLL POSITION IS READ. "Visible row `v`, from `0` to `4`, ... shows the
// arm at index `firstRow + v` in placement order", and "A press inside a cell
// rectangle points the cursor at that row's arm and that column". So the arm a
// press at visible row `v` lands the cursor on is the arm at index `firstRow + v`,
// and reading the cursor back after such a press reads `firstRow`.
//
// THE CONFIGURATION. `BARE` opened in the editor with TEN arms, one per anchor from
// `(-5, 0)` to `(4, 0)`, all on the field and all distinct, so the panel has ten
// rows and only five of them fit. Nothing else is placed, so `editor.parts`'s order
// is the row order without a rowless part in it. The cursor is posed on the arm at
// index `7`, at column `0` — which puts `firstCol` at `max(0, 0 - 39)` = `0`, so
// the columns are unscrolled and visible column `0` is cell `0`.
//
// TWO PRESSES, ONE PER HALF OF THE RULE. The press at visible row `0` reads
// `firstRow` itself, which must be `3`; the press at visible row `4` reads where the
// cursor's own row sits, which must be index `7`. A build that scrolled by
// `selectedRow` would answer `7` to the first and run off the end on the second, and
// one that never scrolled would answer `0` and `4`. The cursor is posed again
// between the two, because the first press moved it.
//
// THE VERDICT. A press at visible row `0` points the cursor at the arm at index `3`,
// and a press at visible row `4` at the arm at index `7`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { at, regionCenter, tapeCell, type Hex } from "../field";
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

/** Ten anchors on one row of the field, `max(|q|, |r|, |q + r|) <= FIELD_R` (`5`). */
const ANCHORS: readonly Hex[] = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4].map((q) =>
  at(q, 0),
);

/** The row the cursor is posed on: index 7, which is past the first five. */
const CURSOR_ROW = 7;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts firstRow at 3 and the cursor's row on the bottom visible row", async () => {
  await openChallengeDocument(h, BARE);
  const arms: number[] = [];
  for (const anchor of ANCHORS) arms.push(await placePart(h, "arm", anchor));
  assertEqual(
    (await h.snapshot()).editor.parts.length,
    ANCHORS.length,
    "the machine is the ten arms and nothing else, so editor.parts's order is the panel's row order",
  );

  await h.debug.setCursor(arms[CURSOR_ROW] as number, 0);
  const top = regionCenter(tapeCell(0, 0));
  await pressAt(h, top);
  await h.advance(1);
  await captureStill(h, "scrolled");
  const atTop = (await h.snapshot()).editor.cursor;
  await releasePointer(h);

  assertNotNull(
    atTop,
    "the press at visible row 0 points the cursor at that row's arm",
  );
  assertEqual(
    atTop?.part,
    arms[3],
    "firstRow is max(0, 7 - 4), which is 3, so visible row 0 shows the arm at index 3",
  );

  await h.debug.setCursor(arms[CURSOR_ROW] as number, 0);
  const bottom = regionCenter(tapeCell(4, 0));
  await pressAt(h, bottom);
  await h.advance(1);
  const atBottom = (await h.snapshot()).editor.cursor;
  await releasePointer(h);

  assertNotNull(
    atBottom,
    "the press at visible row 4 points the cursor at that row's arm",
  );
  assertEqual(
    atBottom?.part,
    arms[CURSOR_ROW],
    "firstRow + 4 is 7, so the cursor's own row is the bottom visible row",
  );
});
