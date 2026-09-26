// editor/left-stops-at-column-zero — `left` at column `0` leaves the cursor
// exactly where it is.
//
// THE RULE. "`left` and `right` move it by one cell, stopping at `0` and moving
// without an upper bound" (`specs/editor.md`, The tape panel). `0` is where `left`
// stops: there is no column before it, and the row is not a place the cursor
// leaves — `up` and `down` are what "move the cursor between rows", and `left` and
// `right` "move it by one cell".
//
// THE CONFIGURATION. Two arms, so both ways a build might overrun column `0` are
// decidable: a cursor that went negative reports a `col` below `0`, and one that
// wrapped onto another row reports another row's `part` — and there is another row
// to wrap onto. The cursor is pointed at the SECOND arm's column `0`, so a wrap to
// the previous row would be visible as the first arm.
//
// THE VERDICT. `editor.cursor` still names the second arm and column `0`.

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

it("holds the cursor at column 0 on its own row", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([
      armPart("arm", -3, 0, 0, 1, ["grab", "drop"]),
      armPart("arm", 0, 0, 0, 1, ["grab", "rotate-cw", "drop"]),
    ]),
  );
  const ids = await partIds(h);
  const arm = ids[1] ?? -1;

  await h.debug.setFocus("tape");
  await h.debug.setCursor(arm, 0);

  const posed = await h.snapshot();
  assertEqual(
    posed.editor.cursor?.col,
    0,
    "the cursor starts at column 0, which is where left stops",
  );
  assertEqual(
    posed.editor.focus,
    "tape",
    "and the focus routes left to the panel",
  );

  await pressAction(h, "left");
  await captureStill(h, "floored");

  const cursor = (await h.snapshot()).editor.cursor;
  assertNotNull(cursor, "the cursor still points at a cell after the press");
  assertEqual(
    cursor?.col,
    0,
    "left stops at 0, so the column neither falls below it nor moves",
  );
  assertEqual(
    cursor?.part,
    arm,
    "and the cursor stays on its own row rather than wrapping to another",
  );
});
