// editor/undo-restores-the-machine-before-the-edit — one undo puts the whole
// machine back where the latest committed edit found it.
//
// THE RULE. "The entry holds the machine as it stood before the edit: the parts
// with their poses, paths, and tapes... The `undo` action restores the machine
// from the latest entry and moves that edit onto the redo side" (`specs/editor.md`,
// Undo and redo). `specs/instrumentation.md` reports the machine as
// `editor.parts`, "placement order; the tape panel's row order", and the depth as
// `editor.undoDepth`.
//
// THE WHOLE MACHINE IS READ, NOT THE EDITED PART. That is what "restores the
// machine" says, and it is what tells this item apart from the ones about a
// particular edit: the check compares `editor.parts` AS THE BUILD REPORTED IT
// before the edit against `editor.parts` after the undo, entry for entry, so a
// build that put the edited part back and disturbed anything else — another part's
// pose, another part's tape, the placement order — fails here.
//
// THE COMPARISON IS THE BUILD'S OWN REPORT AGAINST ITSELF rather than against an
// object written out here, so no field the specification does not fix is being
// required or forbidden. The reading is guarded first: an empty `parts` would
// compare equal to an empty `parts`, so the machine is asserted to be standing.
//
// THE EDIT IS A ROTATION, chosen because it removes and re-adds nothing. Placing
// and deleting are the routes that could make a build renumber the machine, and
// nothing in `specs/` fixes a restored part's id; a rotation asks the entry to
// hold the machine without giving a build any excuse to hand back a different one.
//
// THE CONFIGURATION. An arm at `(0, 0)` at rotation `1`, length `2`, carrying a
// two-cell tape; a three-cell open track at `(-2, 2)`; and a `bind` at `(2, -2)`
// unrotated, whose footprint `(2, -2)`–`(3, -2)` is on the field, meets no track
// cell, and is still on the field one step clockwise, at `(2, -2)`–`(2, -1)`. The
// press turns the bind; the arm and the track are what the undo must not disturb.
//
// THE VERDICT. `editor.parts` after the undo is exactly `editor.parts` before the
// edit, and `editor.undoDepth` is one lower than it was after the edit.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNotEqual,
  assertLength,
} from "../assert";
import { at } from "../field";
import { armPart, sigilPart, solution, trackPart } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureReplay,
  createHarness,
  loadMachine,
  openChallengeDocument,
  partById,
  pressAction,
  solePartOfKind,
  type Harness,
} from "../harness";

/** The machine the edit is made on: three parts, only one of them edited. */
const BIND_AT = at(2, -2);
const TRACK_CELLS = [at(-2, 2), at(-1, 2), at(0, 2)];
const MACHINE = solution([
  armPart("arm", ORIGIN.q, ORIGIN.r, 1, 2, ["grab", "rotate-cw"]),
  trackPart(TRACK_CELLS),
  sigilPart("bind", BIND_AT.q, BIND_AT.r, 0),
]);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves editor.parts exactly as it stood before the edit, and the depth one lower", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(h, MACHINE);

  const readings = await captureReplay(h, "restored", async () => {
    const before = await h.snapshot();
    const bind = solePartOfKind(before, "bind")?.id ?? -1;

    await h.debug.setFocus("field");
    await h.debug.setSelected(bind);
    await pressAction(h, "part-cw");
    const edited = await h.snapshot();

    await pressAction(h, "undo");
    const undone = await h.snapshot();

    return { before, bind, edited, undone };
  });

  const { before, bind, edited, undone } = readings;
  assertLength(
    before.editor.parts,
    MACHINE.parts.length,
    "the machine stands with every part the scenario placed",
  );
  assertNotEqual(
    partById(edited, bind)?.rotation,
    partById(before, bind)?.rotation,
    "the press committed a real edit: the bind's rotation moved",
  );
  assertEqual(
    edited.editor.undoDepth,
    before.editor.undoDepth + 1,
    "and that edit pushed one entry onto the undo history",
  );

  assertDeepEqual(
    undone.editor.parts,
    before.editor.parts,
    "one undo restores the machine as the snapshot reported it before the latest edit",
  );
  assertEqual(
    undone.editor.undoDepth,
    edited.editor.undoDepth - 1,
    "and lowers editor.undoDepth by one",
  );
});
