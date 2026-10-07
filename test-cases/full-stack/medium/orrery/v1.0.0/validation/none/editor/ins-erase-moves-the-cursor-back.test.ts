// editor/ins-erase-moves-the-cursor-back — after an erase the cursor stands one
// cell left of where it stood, on the same row.
//
// THE RULE. "`ins-erase` blanks the cell before the cursor and moves back one,
// and does nothing at column `0`" (`specs/editor.md`, The tape panel). What the
// erase blanked is decided beside this; what this item decides is where the
// cursor came to rest, which the snapshot carries as `editor.cursor`,
// "`{ part: <number>, col: <number> } | null`" (`specs/instrumentation.md`).
//
// THE CONFIGURATION. Two arms, so "on the same row" is a claim that can fail: the
// panel "shows one row per arm and wheel, in placement order"
// (`specs/editor.md`), and the cursor is pointed at the SECOND of the two, at
// column `2` — a column above `0`, which is what the rule's last clause exempts.
// A build that moved back off the row's start onto another row is caught by the
// row beside it.
//
// THE VERDICT. `editor.cursor` names that same arm and column `1`.

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

it("leaves the cursor at column 1 after an erase at column 2", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([
      armPart("arm", -3, 0, 0, 1, ["grab", "drop"]),
      armPart("arm", 0, 0, 0, 1, ["grab", "drop", "rotate-cw", "pivot-cw"]),
    ]),
  );
  const arm = (await partIds(h))[1] ?? -1;

  await h.debug.setFocus("tape");
  await h.debug.setCursor(arm, 2);

  const posed = await h.snapshot();
  assertEqual(
    posed.editor.cursor?.col,
    2,
    "the cursor stands at a column above 0, which is where the erase acts",
  );

  await pressAction(h, "ins-erase");
  await captureStill(h, "moved");

  const cursor = (await h.snapshot()).editor.cursor;
  assertNotNull(cursor, "the cursor still points at a cell after the erase");
  assertEqual(
    cursor?.part,
    arm,
    "the erase moves the cursor back within its own row",
  );
  assertEqual(
    cursor?.col,
    1,
    "ins-erase moves back one, so a cursor at column 2 comes to rest at column 1",
  );
});
