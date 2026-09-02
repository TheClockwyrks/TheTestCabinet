// editor/a-live-drag-reads-no-other-action — while a drag is live the editor reads
// none of the other actions.
//
// THE RULE. "While a drag or lay is live the only actions the editor reads are
// `part-cw`, `part-ccw`, `part-grow`, and `part-shrink`, which act on the ghost,
// and `mute`" (`specs/editor.md`, Dragging). Everything else the editing screen
// would otherwise read — the table in `specs/controls.md` names `undo`, `redo`,
// `play`, `step`, `back` and the field verbs among them — is not read at all while
// a gesture is in hand, so pressing one changes nothing.
//
// THE FIVE PRESSED, and why each would be visible if it were read. `part-delete`
// "removes the selected part", and the press that opened this drag selected the
// part it grabbed. `undo` "restores the machine from the latest entry", and there
// IS a latest entry: the two pointer edits below leave the history one deep.
// `redo` "re-applies the latest undone edit", and there IS one undone: the third
// step below undoes an edit. `play` "starts a run when every rise and every set is
// placed", and this machine is `IDLE_MACHINE` — a rise, a set and an arm — so the
// readiness condition holds and a read `play` would start a run. `step` "under the
// same condition starts the run paused at its settle". None of the five is a
// no-op in this world, which is what makes the point decidable rather than
// vacuous.
//
// THE CONFIGURATION. `BARE` opened in the editor and `IDLE_MACHINE` loaded: a rise
// on `(-3, 0)`, a set on `(3, 0)`, and an arm on `(0, 0)`. Loading "empties both
// histories", so the history is built by the pointer, which is the only thing that
// pushes entries: the arm is dragged to `(1, 0)` and back to `(0, 0)`, leaving two
// entries, and one `undo` then leaves one entry undone and one to undo. A press on
// the arm's hex opens the move drag, and the five actions are pressed with it
// still live.
//
// THE VERDICT. `sim` is still `null` — no run started; the three parts stand
// exactly as they did, anchors and all — nothing was deleted, undone or redone;
// both history depths are unmoved; and the drag is still live, so the gesture
// itself survived the five presses.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import { at, hexCenter, type Hex } from "../field";
import { BARE, IDLE_MACHINE, ORIGIN } from "../fixtures";
import {
  captureReplay,
  createHarness,
  drag,
  loadMachine,
  openChallengeDocument,
  partIds,
  pressAction,
  pressAt,
  releasePointer,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

/** Where the arm is dragged and dragged back, to leave two entries on the history. */
const ASIDE: Hex = at(1, 0);

/** Every part's id, kind and anchor, which is what "changed nothing" is read against. */
function machineOf(snapshot: OrrerySnapshot): string[] {
  return snapshot.editor.parts.map(
    (part) =>
      `${part.id}:${part.kind}:${part.q},${part.r}:${part.rotation}:${part.length}`,
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("changes nothing when part-delete, undo, redo, play or step is pressed mid-drag", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(h, IDLE_MACHINE);
  const ids = await partIds(h);
  assertEqual(ids.length, 3, "the rise, the set and the arm are on the field");

  // Two pointer edits, so `undo` has an entry to restore, then one undo, so
  // `redo` has an edit to re-apply.
  await drag(h, hexCenter(ORIGIN), hexCenter(ASIDE));
  await drag(h, hexCenter(ASIDE), hexCenter(ORIGIN));
  await pressAction(h, "undo");

  const before = await h.snapshot();
  assertEqual(
    before.editor.undoDepth,
    1,
    "one edit is left to undo, so a read undo would change the machine",
  );
  assertEqual(
    before.editor.redoDepth,
    1,
    "one edit is left to redo, so a read redo would change the machine",
  );
  assertNull(before.sim, "no run is live before the drag opens");

  await pressAt(h, hexCenter(ASIDE));
  const opened = await h.snapshot();
  assertEqual(
    opened.editor.drag?.kind,
    "move",
    "the press on the arm opens a move drag, which is the live gesture the rule is about",
  );
  assertEqual(
    opened.editor.selected,
    opened.editor.drag?.kind === "move" ? opened.editor.drag.part : null,
    "the press selected the part it grabbed, so a read part-delete would remove it",
  );

  const after = await captureReplay(h, "ignored", async () => {
    for (const action of [
      "part-delete",
      "undo",
      "redo",
      "play",
      "step",
    ] as const) {
      await pressAction(h, action);
    }
    return h.snapshot();
  });
  await releasePointer(h);

  assertNull(
    after.sim,
    "play and step are not read while a drag is live, so no run started",
  );
  assertDeepEqual(
    machineOf(after),
    machineOf(before),
    "part-delete, undo and redo are not read while a drag is live, so every part stands as it did",
  );
  assertEqual(
    after.editor.undoDepth,
    before.editor.undoDepth,
    "no entry was taken off the undo history, because undo was not read",
  );
  assertEqual(
    after.editor.redoDepth,
    before.editor.redoDepth,
    "no entry was taken off the redo history, because redo was not read",
  );
  assertEqual(
    after.editor.drag?.kind,
    "move",
    "the gesture itself is still live: none of the five presses ended it",
  );
});
