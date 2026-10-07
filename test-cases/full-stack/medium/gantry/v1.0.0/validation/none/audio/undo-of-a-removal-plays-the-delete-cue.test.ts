// audio/undo-of-a-removal-plays-the-delete-cue — every undo plays `delete`.
//
// specs/ui.md § Audio, the `delete` row: the cue plays when "a structure edit
// removes one of those, AND EVERY `undo`". The second clause is unconditional —
// the cue follows the act of undoing rather than what the undo happens to do — so
// an undo that puts a member BACK plays `delete` and not `place`, even though the
// structure gains a member. A build that reads the restored member and sounds the
// clack instead has read the table's `place` row, whose event is "a structure
// edit places a member", and an undo is not a structure edit.
//
// THE UNDO REVERSES A REMOVAL, which is the case that tells the two readings
// apart. An undo of a placement removes a member and would sound `delete` under
// either reading; only an undo that restores one separates "every undo plays
// `delete`" from "the cue follows what changed".
//
// THE UNDO IS DRIVEN BY ITS KEY, because there is no pose for it: the surface
// specs/instrumentation.md fixes carries the structure edits and not the history,
// so the `undo` action bound in specs/controls.md is the only way to reach it.
//
// THE TWO EDITS BEFORE IT ARE POSED, so nothing but the undo is under test: the
// member is placed and removed through the surface, each given a frame to sound
// on and drained, and the window this check reads holds the key press alone.
//
// THE STRUCTURE IS READ BACK, because the point rests on the undo having actually
// restored the member: an undo that did nothing would be silent for a reason that
// belongs to the editor's own points.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { BINDINGS } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** Site 1, First Lift. */
const SITE = 0;

/** The member placed, removed, and put back: one of the crane's legs. */
const MEMBER = { a: { x: 0, y: 0, z: 0 }, b: { x: 0, y: 2, z: 0 } } as const;

/** The key specs/controls.md binds `undo` to. */
const UNDO_KEY = BINDINGS.undo[0] as string;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("plays the delete cue on an undo that restores a removed member", async () => {
  await openSite(h, SITE);
  await clearAll(h);

  await h.debug.addMember(
    MEMBER.a.x,
    MEMBER.a.y,
    MEMBER.a.z,
    MEMBER.b.x,
    MEMBER.b.y,
    MEMBER.b.z,
    "strut",
  );
  await h.advance(1);
  await h.cues();

  await h.debug.removeMember(0);
  await h.advance(1);
  await h.cues();
  const removed = await h.snapshot();
  assertLength(
    removed.structure.members,
    0,
    "the members standing after the removal (specs/structure.md)",
  );

  await h.press(UNDO_KEY);
  await h.advance(1);
  const onUndo = await h.cues();
  const restored = await h.snapshot();
  await h.capture("undo", "The member restored by the undo");

  assertLength(
    restored.structure.members,
    1,
    'the member the undo restores: undo "restores the structure to what it ' +
      'was before the most recent structure-changing edit" ' +
      "(specs/structure.md)",
  );
  assertEqual(
    restored.historyDepth,
    removed.historyDepth - 1,
    "the undo history the undo spends (specs/structure.md)",
  );
  assertEqual(
    JSON.stringify([...new Set(onUndo)].sort()),
    JSON.stringify(["delete"]),
    'the cue an undo plays: `delete` follows "a structure edit removes one ' +
      'of those, and EVERY `undo`" (specs/ui.md § Audio), whatever the undo ' +
      "reversed — so an undo that puts a member back sounds `delete` and " +
      `never \`place\`. It sounded ${JSON.stringify(onUndo)}`,
  );
});
