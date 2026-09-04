// editor/left-moves-the-cursor-one-cell — `ArrowLeft` under tape focus steps the
// cursor one column left, on the row it stood on.
//
// THE RULE. "`left` and `right` move it by one cell, stopping at `0` and moving
// without an upper bound" (`specs/editor.md`, The tape panel), and
// `specs/controls.md` names the direction: "`left` — `ArrowLeft`... Tape focus:
// moves the cursor one cell left." "By one cell" is a move along the row, so the
// row it names is the row it named before: the snapshot carries the hand as
// `editor.cursor`, "`{ part: <number>, col: <number> } | null`"
// (`specs/instrumentation.md`).
//
// THE CONFIGURATION. Two arms, so "leaving its part unchanged" is a claim that can
// fail: the panel "shows one row per arm and wheel, in placement order"
// (`specs/editor.md`), and the cursor is pointed at the SECOND of the two, at
// column `3` — comfortably above the `0` the move stops at, so this press is a
// plain step rather than the floor decided beside it. The focus is `tape`, because
// `specs/controls.md` gives the editor `left` "under `tape` focus" alone.
//
// THE VERDICT. `editor.cursor` names that same arm and column `2`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadMachine,
  openChallengeDocument,
  partIds,
  pressAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("steps the cursor from column 3 to column 2", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([
      armPart("arm", -3, 0, 0, 1, ["grab", "drop"]),
      armPart("arm", 0, 0, 0, 1, [
        "grab",
        "rotate-cw",
        "rotate-cw",
        "pivot-cw",
        "drop",
      ]),
    ]),
  );
  const arm = (await partIds(h))[1] ?? -1;

  await h.debug.setFocus("tape");
  await h.debug.setCursor(arm, 3);

  const posed = await h.snapshot();
  assertEqual(
    posed.editor.cursor?.col,
    3,
    "the cursor starts at column 3, above the 0 the move stops at",
  );
  assertEqual(
    posed.editor.focus,
    "tape",
    "and the focus routes left to the panel",
  );

  await pressAction(h, "left");
  await captureStill(h, "moved");

  const cursor = (await h.snapshot()).editor.cursor;
  assertNotNull(cursor, "the cursor still points at a cell after the press");
  assertEqual(cursor?.part, arm, "left moves the cursor within its own row");
  assertEqual(cursor?.col, 2, "left moves the cursor one cell left");
});
