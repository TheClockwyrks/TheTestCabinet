// editor/up-wraps-at-the-first-row — `up` on the first row lands on the LAST row
// rather than stopping.
//
// THE RULE. "`up` and `down` move the cursor between rows, wrapping at both ends"
// (`specs/editor.md`, The tape panel). The end `up` reaches is the first row, and
// wrapping there is the last row — the panel "shows one row per arm and wheel, in
// placement order", and `editor.parts` is that order ("placement order; the tape
// panel's row order", `specs/instrumentation.md`).
//
// THE CONFIGURATION. THREE arms, which is what separates a wrap from a step: with
// two rows the last row is also the previous one, and every build that moved at
// all would pass. With three, the row this item requires is index `2`, a build
// that clamped at the end stays on index `0`, and one that stepped the other way
// lands on index `1`.
//
// THE VERDICT. `editor.cursor.part` is the id of the arm at index `2` of
// `editor.parts`, the machine's last row.

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

it("carries the cursor from the first row to the third", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(h, THREE_ROWS);
  const rows = await partIds(h);
  assertEqual(
    rows.length,
    3,
    "three rows stand, so wrapping to the last is not the same as stepping",
  );

  await h.debug.setFocus("tape");
  await h.debug.setCursor(rows[0] ?? -1, 0);

  const posed = await h.snapshot();
  assertEqual(
    posed.editor.cursor?.part,
    rows[0],
    "the cursor starts on the first row, which is the end up wraps at",
  );
  assertEqual(
    posed.editor.focus,
    "tape",
    "and the focus routes up to the panel",
  );

  await pressAction(h, "up");
  await captureStill(h, "wrapped");

  const cursor = (await h.snapshot()).editor.cursor;
  assertNotNull(cursor, "the cursor still points at a row after the press");
  assertEqual(
    cursor?.part,
    rows[2],
    "up wraps at the first row, so the cursor lands on the last row",
  );
});
