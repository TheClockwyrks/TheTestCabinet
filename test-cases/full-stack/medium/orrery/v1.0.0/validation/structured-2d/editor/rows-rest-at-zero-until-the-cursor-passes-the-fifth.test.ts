// editor/rows-rest-at-zero-until-the-cursor-passes-the-fifth — the panel does not
// scroll while the cursor's row is one of the first five.
//
// THE RULE. "`firstRow = max(0, selectedRow - (TAPE_ROWS_VISIBLE - 1))`, where
// `selectedRow` is the cursor's arm's index in placement order, and `0` with no
// cursor" (`specs/editor.md`, The tape panel), with `TAPE_ROWS_VISIBLE` `5`. With
// the cursor on the arm at index `3`, that is `max(0, 3 - 4)` = `max(0, -1)` = `0`.
//
// HOW A SCROLL POSITION IS READ. The same section makes the visible rows the
// observable: "Visible row `v`, from `0` to `4`, ... shows the arm at index
// `firstRow + v` in placement order", and "A press inside a cell rectangle points
// the cursor at that row's arm and that column". So the arm a press at visible row
// `v` lands the cursor on is the arm at index `firstRow + v`, and reading the
// cursor back after such a press reads `firstRow`.
//
// THE CONFIGURATION. `BARE` opened in the editor with TEN arms, one per anchor from
// `(-5, 0)` to `(4, 0)`, all on the field and all distinct, so the panel has ten
// rows and only five of them fit. Nothing else is placed, so `editor.parts`'s order
// is the row order without a rowless part in it. The cursor is posed on the arm at
// index `3`, at column `0` — which puts `firstCol` at `max(0, 0 - 39)` = `0` too,
// so the columns are unscrolled and visible column `0` is cell `0`.
//
// TWO PRESSES, NOT ONE. A press at visible row `0` alone is satisfied by a build
// that answers the cursor's own row to every press, since the cursor's row is `3`
// and index `0` is not `3` — but a build that scrolled by `selectedRow` rather than
// by `max(0, selectedRow - 4)` would put the arm at index `3` on visible row `0`
// and pass. So visible row `4` is pressed as well, where `firstRow` `0` puts the
// arm at index `4` and the wrong rule would put the arm at index `7`. The cursor is
// posed again between the two, because the first press moved it.
//
// THE VERDICT. A press at visible row `0` points the cursor at the arm placed
// first, and a press at visible row `4` at the arm placed fifth.

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

/** The row the cursor is posed on: index 3, which is within the first five. */
const CURSOR_ROW = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves firstRow at 0 with the cursor on the arm at index 3", async () => {
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
  await captureStill(h, "unscrolled");
  const atTop = (await h.snapshot()).editor.cursor;
  await releasePointer(h);

  assertNotNull(
    atTop,
    "the press at visible row 0 points the cursor at that row's arm",
  );
  assertEqual(
    atTop?.part,
    arms[0],
    "firstRow is max(0, 3 - 4), which is 0, so visible row 0 shows the arm at index 0",
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
    arms[4],
    "visible row v shows the arm at index firstRow + v, and firstRow is 0, so visible row 4 shows the arm at index 4",
  );
});
