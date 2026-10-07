// editor/down-wraps-at-the-last-row — `down` on the last row lands on the FIRST
// row rather than stopping.
//
// THE RULE. "`up` and `down` move the cursor between rows, wrapping at both ends"
// (`specs/editor.md`, The tape panel). The end `down` reaches is the last row, and
// wrapping there is the first row — the panel "shows one row per arm and wheel, in
// placement order", and `editor.parts` is that order ("placement order; the tape
// panel's row order", `specs/instrumentation.md`).
//
// THE CONFIGURATION. THREE arms, which is what separates a wrap from a step: with
// two rows the first row is also the next one, and every build that moved at all
// would pass. With three, the row this item requires is index `0`, a build that
// clamped at the end stays on index `2`, and one that stepped the other way lands
// on index `1`.
//
// THE VERDICT. `editor.cursor.part` is the id of the arm at index `0` of
// `editor.parts`, the machine's first row.

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

it("carries the cursor from the third row to the first", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(h, THREE_ROWS);
  const rows = await partIds(h);
  assertEqual(
    rows.length,
    3,
    "three rows stand, so wrapping to the first is not the same as stepping",
  );

  await h.debug.setFocus("tape");
  await h.debug.setCursor(rows[2] ?? -1, 0);

  const posed = await h.snapshot();
  assertEqual(
    posed.editor.cursor?.part,
    rows[2],
    "the cursor starts on the last row, which is the end down wraps at",
  );
  assertEqual(
    posed.editor.focus,
    "tape",
    "and the focus routes down to the panel",
  );

  await pressAction(h, "down");
  await captureStill(h, "wrapped");

  const cursor = (await h.snapshot()).editor.cursor;
  assertNotNull(cursor, "the cursor still points at a row after the press");
  assertEqual(
    cursor?.part,
    rows[0],
    "down wraps at the last row, so the cursor lands on the first row",
  );
});
