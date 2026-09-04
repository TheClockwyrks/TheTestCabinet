// instrumentation/snapshot-resting-values — a field the situation does not use
// reports its resting value rather than going missing.
//
// THE RULE, from `specs/instrumentation.md`, Snapshot shape: "The shape is fixed,
// and every field is present whatever the screen and mode. A field the current
// situation does not use reports its resting value rather than going missing",
// followed by the table this check reads row by row:
//
//   `challenge`                                   null away from the editor
//   `editor`                                      present always; empty `parts`,
//                                                 `cost` 0, `period` 1,
//                                                 `selected` and `cursor` null,
//                                                 `focus` "field", `drag` null,
//                                                 both depths 0 when nothing is
//                                                 open
//   `sim`                                         null while editing
//   `campaign.unlockedCount`                      1
//   `campaign.stashed`, `extras.stashed`          empty
//   `campaign.last`, `extras.last`, `selectIndex` 0
//   `howtoPage`                                   0 away from `howto`
//   `completion`                                  true
//
// THE CONFIGURATION is a session with nothing done to it, read on the two screens
// the table's rows distinguish. The title screen, straight off a `reset`, is where
// "nothing is open" and "away from the editor" hold at once. Then one challenge is
// opened, with nothing placed and no run started, which is where "`sim` null while
// editing" is the row that applies and `challenge` stops resting.
//
// THE VERDICT. Every field named above is present and carries the value the table
// gives it, and the editor is present on a screen that has no editor at all.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertHasProperty,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  openSelect,
  openTitle,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports each resting value on a session that has used none of them", async () => {
  await openTitle(h);
  await captureStill(h, "resting");
  const title = await h.snapshot();

  assertHasProperty(title, "challenge", "challenge is present on every screen");
  assertNull(title.challenge, "challenge is null away from the editor");

  assertHasProperty(title, "editor", "editor is present on every screen");
  assertLength(
    title.editor.parts,
    0,
    "editor.parts is empty with nothing placed",
  );
  assertEqual(title.editor.cost, 0, "editor.cost is 0 with nothing placed");
  assertEqual(
    title.editor.period,
    1,
    "editor.period is 1 when every tape is empty",
  );
  assertNull(title.editor.selected, "editor.selected is null");
  assertNull(title.editor.cursor, "editor.cursor is null");
  assertEqual(title.editor.focus, "field", "editor.focus is field");
  assertNull(title.editor.drag, "editor.drag is null");
  assertEqual(title.editor.undoDepth, 0, "editor.undoDepth is 0");
  assertEqual(title.editor.redoDepth, 0, "editor.redoDepth is 0");

  assertHasProperty(title, "sim", "sim is present on every screen");
  assertNull(title.sim, "sim is null with no run");

  assertEqual(
    title.campaign.unlockedCount,
    1,
    "campaign.unlockedCount rests at 1: only the first challenge is open",
  );
  assertDeepEqual(title.campaign.stashed, [], "campaign.stashed rests empty");
  assertDeepEqual(title.extras.stashed, [], "extras.stashed rests empty");
  assertEqual(title.campaign.last, 0, "campaign.last rests at 0");
  assertEqual(title.extras.last, 0, "extras.last rests at 0");
  assertEqual(title.selectIndex, 0, "selectIndex rests at 0");
  assertEqual(title.howtoPage, 0, "howtoPage is 0 away from the how-to");
  assertEqual(title.completion, true, "the completion switch rests on");

  await openSelect(h, "campaign");
  const select = await h.snapshot();
  assertNull(select.challenge, "challenge is null away from the editor");
  assertNull(select.sim, "sim is null with no run");
  assertEqual(select.howtoPage, 0, "howtoPage is 0 away from the how-to");
  assertLength(
    select.editor.parts,
    0,
    "editor is present on the select screen, with nothing open",
  );

  await openChallengeDocument(h, BARE);
  const editing = await h.snapshot();
  assertNotNull(
    editing.challenge,
    "the challenge stops resting once one is open in the editor",
  );
  assertNull(editing.sim, "sim is null while editing");
  assertEqual(editing.howtoPage, 0, "howtoPage is 0 away from the how-to");
  assertEqual(editing.completion, true, "the completion switch rests on");
  assertLength(
    editing.editor.parts,
    0,
    "an opened challenge starts with an empty machine",
  );
  assertEqual(editing.editor.cost, 0, "editor.cost is 0 with nothing placed");
  assertEqual(
    editing.editor.period,
    1,
    "editor.period is 1 with no tape written",
  );
  assertNull(editing.editor.selected, "editor.selected is null");
  assertNull(editing.editor.cursor, "editor.cursor is null");
  assertNull(editing.editor.drag, "editor.drag is null");
  assertEqual(editing.editor.undoDepth, 0, "editor.undoDepth is 0");
  assertEqual(editing.editor.redoDepth, 0, "editor.redoDepth is 0");
});
