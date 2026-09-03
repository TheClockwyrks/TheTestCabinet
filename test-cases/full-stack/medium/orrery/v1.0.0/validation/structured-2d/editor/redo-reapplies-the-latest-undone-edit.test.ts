// editor/redo-reapplies-the-latest-undone-edit — one redo after one undo puts the
// machine back where the undo found it, and the two sides trade back.
//
// THE RULE. "`redo` re-applies the latest undone edit" (`specs/editor.md`, Undo
// and redo), the counterpart of the undo the sentence before it describes.
// `specs/instrumentation.md` reports the machine as `editor.parts` and the two
// sides as `editor.undoDepth` and `editor.redoDepth`.
//
// THE WHOLE MACHINE IS READ. "Re-applies the latest undone edit" is a claim about
// the machine, so the check compares `editor.parts` AS THE BUILD REPORTED IT just
// before the undo against `editor.parts` after the redo, entry for entry — a build
// that re-applied the edit and disturbed anything else fails here. The comparison
// is the build's own report against itself rather than against an object written
// out here, so no field the specification does not fix is required or forbidden.
//
// AND IT TAKES IN EACH PART'S IDENTITY, because `editor.parts` carries every
// part's `id` and the rule fixes it: "A part an entry restores is the part it
// was, its identity included" (`specs/editor.md`, Undo and redo). A build that
// re-applied the edit and renumbered the machine while doing it fails here.
//
// THE EDIT IS A ROTATION, which changes one part and touches the placement order
// of none, so what the redo has to re-apply is one edit over a machine that is
// otherwise exactly the one the undo left.
//
// THE UNDO IS READ AS WELL AS THE REDO. If the undo restored nothing, the parts
// after the redo would trivially equal the parts before it, so the check reads
// that the undo actually moved the machine before asking the redo to move it back.
//
// THE CONFIGURATION. An arm at `(0, 0)` at rotation `1`, length `2`, carrying a
// two-cell tape; a three-cell open track at `(-2, 2)`; and a `bind` at `(2, -2)`
// unrotated, whose footprint `(2, -2)`–`(3, -2)` is on the field and stays on it
// one step clockwise. The press turns the bind; the arm and the track are what
// neither the undo nor the redo may disturb.
//
// THE VERDICT. After the redo, `editor.parts` is exactly what it was before the
// undo, `editor.redoDepth` is one lower than the undo left it, and
// `editor.undoDepth` is one higher.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNotEqual,
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

it("leaves editor.parts exactly as it stood before the undo, and trades the two depths back", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(h, MACHINE);

  const readings = await captureReplay(h, "redone", async () => {
    const posed = await h.snapshot();
    const bind = solePartOfKind(posed, "bind")?.id ?? -1;

    await h.debug.setFocus("field");
    await h.debug.setSelected(bind);
    await pressAction(h, "part-cw");
    const edited = await h.snapshot();

    await pressAction(h, "undo");
    const undone = await h.snapshot();

    await pressAction(h, "redo");
    const redone = await h.snapshot();

    return { posed, bind, edited, undone, redone };
  });

  const { posed, bind, edited, undone, redone } = readings;
  assertLength(
    posed.editor.parts,
    MACHINE.parts.length,
    "the machine stands with every part the scenario placed",
  );
  assertNotEqual(
    partById(edited, bind)?.rotation,
    partById(posed, bind)?.rotation,
    "the press committed a real edit: the bind's rotation moved",
  );
  assertNotEqual(
    partById(undone, bind)?.rotation,
    partById(edited, bind)?.rotation,
    "and the undo took it back, so the redo has an edit to re-apply",
  );
  assertEqual(
    undone.editor.redoDepth,
    posed.editor.redoDepth + 1,
    "the undo moved that edit onto the redo side",
  );

  assertDeepEqual(
    redone.editor.parts,
    edited.editor.parts,
    "one redo re-applies the latest undone edit, leaving the machine as it stood before the undo",
  );
  assertEqual(
    redone.editor.redoDepth,
    undone.editor.redoDepth - 1,
    "and lowers editor.redoDepth by one",
  );
  assertEqual(
    redone.editor.undoDepth,
    undone.editor.undoDepth + 1,
    "and raises editor.undoDepth by one",
  );
});
