// instrumentation/set-cursor-null-clears — the operation that clears the tape
// cursor.
//
// THE RULE. "`setCursor(part, col)` | Points the tape cursor at column `col` of
// that part's row, a whole number of at least `0`. A `part` of `null` clears the
// cursor, and a part with no tape row throws"
// (`specs/instrumentation.md`, The editor's hands). The snapshot carries the hand
// as `editor.cursor`, `{ part, col } | null`, whose resting value is `null`
// (`specs/instrumentation.md`, Snapshot shape).
//
// `col` IS PASSED ALL THE SAME. The row spells the operation `setCursor(part,
// col)` and states of `col` that it is "a whole number of at least `0`", and "An
// argument outside the domain its operation states is invalid, and the call fails
// loudly" — so a build is free to refuse an absent column even while the `part` is
// `null`. The check clears the cursor with a column in the domain.
//
// THE VERDICT IS THE HAND, and the still is the evidence for the panel drawing no
// cursor. The cursor is posed first, so the clearing has something to clear: a
// build that never pointed the cursor anywhere would satisfy "the cursor is
// `null`" for the wrong reason.
//
// THE WORLD IS POSED, NOT SEARCHED. A posed challenge, an empty machine and one
// arm, which is the whole of what a cursor needs. No run is started: the cursor is
// an editing hand.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  placePart,
  type Harness,
} from "../harness";
import { BARE, ORIGIN } from "../fixtures";

/** The column the cursor stands at before it is cleared. */
const COLUMN = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the cursor null", async () => {
  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();
  const arm = await placePart(h, "arm", ORIGIN, 0);

  await h.debug.setCursor(arm, COLUMN);
  const posed = await h.snapshot();
  assertNotNull(
    posed.editor.cursor,
    "the cursor stands on a cell before it is cleared",
  );
  assertEqual(
    posed.editor.cursor?.part,
    arm,
    "the cursor stands on the arm's row before it is cleared",
  );
  assertEqual(
    posed.editor.cursor?.col,
    COLUMN,
    "the cursor stands on the posed column before it is cleared",
  );

  await h.debug.setCursor(null, 0);
  await h.advance(1);
  await captureStill(h, "cleared");

  const cleared = await h.snapshot();
  assertNull(
    cleared.editor.cursor,
    "setCursor with a part of null clears the cursor",
  );
});
