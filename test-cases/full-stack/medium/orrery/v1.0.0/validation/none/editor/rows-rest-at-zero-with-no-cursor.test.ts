// editor/rows-rest-at-zero-with-no-cursor — with no cursor the panel rests on the
// first row.
//
// THE RULE. "`firstRow = max(0, selectedRow - (TAPE_ROWS_VISIBLE - 1))`, where
// `selectedRow` is the cursor's arm's index in placement order, and `0` with no
// cursor" (`specs/editor.md`, The tape panel). The trailing clause is this item's:
// with `editor.cursor` `null` there is no `selectedRow` to subtract from, and
// `firstRow` is `0`.
//
// HOW A SCROLL POSITION IS READ. "Visible row `v`, from `0` to `4`, ... shows the
// arm at index `firstRow + v` in placement order", and "A press inside a cell
// rectangle points the cursor at that row's arm and that column". So the arm a
// press at visible row `v` lands the cursor on is the arm at index `firstRow + v`,
// and reading the cursor back after such a press reads `firstRow`.
//
// THE CONFIGURATION. `BARE` opened in the editor with TEN arms, one per anchor from
// `(-5, 0)` to `(4, 0)`, all on the field and all distinct, so the panel has ten
// rows and only five of them fit — a machine whose panel would scroll if anything
// asked it to. Nothing else is placed, so `editor.parts`'s order is the row order
// without a rowless part in it. `setCursor(null, 0)` clears the cursor, which is
// the operation `specs/instrumentation.md` gives for it: "A `part` of `null` clears
// the cursor."
//
// TWO PRESSES, NOT ONE. The press at visible row `0` is the item's own, and a build
// that ignored the row a press landed in would pass it by answering the first row
// to everything. So visible row `2` is pressed as well, from the same cleared
// cursor, where `firstRow` `0` puts the arm at index `2`.
//
// THE VERDICT. From a cleared cursor, a press at visible row `0` points the cursor
// at the arm placed first, and a press at visible row `2` at the arm at index `2`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows the arm at index v on visible row v while the cursor is null", async () => {
  await openChallengeDocument(h, BARE);
  const arms: number[] = [];
  for (const anchor of ANCHORS) arms.push(await placePart(h, "arm", anchor));
  assertEqual(
    (await h.snapshot()).editor.parts.length,
    ANCHORS.length,
    "the machine is the ten arms and nothing else, so editor.parts's order is the panel's row order",
  );

  await h.debug.setCursor(null, 0);
  const clearedFirst = (await h.snapshot()).editor.cursor;
  await pressAt(h, regionCenter(tapeCell(0, 0)));
  await h.advance(1);
  await captureStill(h, "top");
  const atTop = (await h.snapshot()).editor.cursor;
  await releasePointer(h);

  await h.debug.setCursor(null, 0);
  const clearedAgain = (await h.snapshot()).editor.cursor;
  await pressAt(h, regionCenter(tapeCell(2, 0)));
  await h.advance(1);
  const atThird = (await h.snapshot()).editor.cursor;
  await releasePointer(h);

  assertNull(
    clearedFirst,
    "the cursor is cleared before the first press, so firstRow is the no-cursor case",
  );
  assertNotNull(
    atTop,
    "the press at visible row 0 points the cursor at that row's arm",
  );
  assertEqual(
    atTop?.part,
    arms[0],
    "firstRow is 0 with no cursor, so visible row 0 shows the arm at index 0",
  );

  assertNull(
    clearedAgain,
    "the cursor is cleared again, so the second press is made from the same state",
  );
  assertNotNull(
    atThird,
    "the press at visible row 2 points the cursor at that row's arm",
  );
  assertEqual(
    atThird?.part,
    arms[2],
    "firstRow is 0 with no cursor, so visible row 2 shows the arm at index 2",
  );
});
