// editor/up-moves-the-cursor-to-the-previous-row — `ArrowUp` under tape focus
// points the cursor at the row above the one it stood on.
//
// THE RULE. "`up` and `down` move the cursor between rows, wrapping at both ends"
// (`specs/editor.md`, The tape panel), and `specs/controls.md` names the direction:
// "`up` — `ArrowUp`... Tape focus: moves the tape cursor to the previous row."
// Which row is "previous" follows from the panel's own order: it "shows one row
// per arm and wheel, in placement order", and `editor.parts` is that order
// ("placement order; the tape panel's row order", `specs/instrumentation.md`).
//
// THE CONFIGURATION. THREE arms, so the move is decidable in both ways it could
// go wrong: a build that moved DOWN instead lands on the third row, and one that
// wrapped instead of stepping lands on the third as well, while the row this item
// requires is the first. The cursor starts on the arm at index `1`, the middle
// row, so the press is a plain step rather than the wrap decided beside it. The
// focus is `tape`, because `specs/controls.md` gives the editor `up` "under `tape`
// focus" alone.
//
// THE VERDICT. `editor.cursor.part` is the id of the arm at index `0` of
// `editor.parts`.

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

/** Three rows, in placement order: one arm apiece, each on its own anchor. */
const THREE_ROWS = solution([
  armPart("arm", -3, 0, 0, 1, ["grab"]),
  armPart("arm", 0, 0, 0, 1, ["drop"]),
  armPart("arm", 3, 0, 0, 1, ["rotate-cw"]),
]);

it("points the cursor at the row at index 0 from the row at index 1", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(h, THREE_ROWS);
  const rows = await partIds(h);
  assertEqual(
    rows.length,
    3,
    "the panel stands with three rows to move between",
  );

  await h.debug.setFocus("tape");
  await h.debug.setCursor(rows[1] ?? -1, 0);

  const posed = await h.snapshot();
  assertEqual(
    posed.editor.cursor?.part,
    rows[1],
    "the cursor starts on the row at index 1",
  );
  assertEqual(
    posed.editor.focus,
    "tape",
    "and the focus routes up to the panel",
  );

  await pressAction(h, "up");
  await captureStill(h, "moved");

  const cursor = (await h.snapshot()).editor.cursor;
  assertNotNull(cursor, "the cursor still points at a row after the press");
  assertEqual(
    cursor?.part,
    rows[0],
    "up moves the cursor to the previous row in placement order",
  );
});
