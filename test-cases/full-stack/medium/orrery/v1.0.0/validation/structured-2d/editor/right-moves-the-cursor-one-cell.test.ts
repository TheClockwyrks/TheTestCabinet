// editor/right-moves-the-cursor-one-cell — `ArrowRight` under tape focus steps the
// cursor one column right, on the row it stood on.
//
// THE RULE. "`left` and `right` move it by one cell, stopping at `0` and moving
// without an upper bound" (`specs/editor.md`, The tape panel), and
// `specs/controls.md` names the direction: "`right` — `ArrowRight`... Tape focus:
// moves the cursor one cell right." "By one cell" is a move along the row, so the
// row it names is the row it named before: the snapshot carries the hand as
// `editor.cursor`, "`{ part: <number>, col: <number> } | null`"
// (`specs/instrumentation.md`).
//
// THE CONFIGURATION. Two arms, so a move that left the row is a claim that can
// fail: the panel "shows one row per arm and wheel, in placement order"
// (`specs/editor.md`), and the cursor is pointed at the SECOND of the two, at
// column `3` of a five-cell tape — well inside the tape, so this press is a plain
// step rather than the carry past the last cell decided beside it. The focus is
// `tape`, because `specs/controls.md` gives the editor `right` "under `tape` focus"
// alone.
//
// THE VERDICT. `editor.cursor` names that same arm and column `4`.

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

it("steps the cursor from column 3 to column 4", async () => {
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
  assertEqual(posed.editor.cursor?.col, 3, "the cursor starts at column 3");
  assertEqual(
    posed.editor.focus,
    "tape",
    "and the focus routes right to the panel",
  );

  await pressAction(h, "right");
  await captureStill(h, "moved");

  const cursor = (await h.snapshot()).editor.cursor;
  assertNotNull(cursor, "the cursor still points at a cell after the press");
  assertEqual(cursor?.part, arm, "right moves the cursor within its own row");
  assertEqual(cursor?.col, 4, "right moves the cursor one cell right");
});
