// editor/undo-moves-the-edit-onto-the-redo-side — every undo puts the edit it took
// onto the redo side, so the two depths trade one for one.
//
// THE RULE. "The `undo` action restores the machine from the latest entry and
// MOVES THAT EDIT ONTO THE REDO SIDE" (`specs/editor.md`, Undo and redo).
// `specs/instrumentation.md` reports the two sides as `editor.undoDepth` and
// `editor.redoDepth`.
//
// THE READING IS PER PRESS, NOT ONLY AT THE END. "Moves that edit" is a claim
// about each undo, so the two depths are read after every one of the three
// presses: the redo side rises by one and the undo side falls by one each time,
// which is a stronger reading than three at the end and a weaker build than the
// rule allows cannot pass it by arriving at three some other way.
//
// THE CONFIGURATION. One arm at `(0, 0)` with an EMPTY tape, alone on the field,
// and three writes at the cursor — `ins-grab`, `ins-rotate-cw`, `ins-drop`
// (`specs/controls.md`) — each landing on a blank cell, so each changes the tape
// and each "pushes one entry onto the undo history". The three edits are tape
// writes because they are the shortest committed edits there are; what the item
// decides is where an undone edit GOES, not what an entry holds.
//
// THE DEPTHS ARE READ AS A RISE AND A FALL, NOT AS VALUES, because what the
// history holds when the scenario is posed belongs to the operations that posed
// it, and `specs/instrumentation.md` says none of them pushes an entry.
//
// THE VERDICT. After three edits the redo side stands where it stood; after each
// undo it is one higher and the undo side one lower; and three undos leave a redo
// depth three above where the scenario found it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import type { ActionName } from "../constants";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadMachine,
  openChallengeDocument,
  pressAction,
  solePartOfKind,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

/** The three writes, each onto a blank cell, so each is a committed edit. */
const WRITES: readonly ActionName[] = ["ins-grab", "ins-rotate-cw", "ins-drop"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises the redo depth by one for each undo press, so three undos leave three", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, [])]),
  );

  const posed = await h.snapshot();
  assertNotNull(
    solePartOfKind(posed, "arm"),
    "the machine stands with one arm for the writes to land on",
  );
  const arm = solePartOfKind(posed, "arm")?.id ?? -1;

  await h.debug.setFocus("tape");
  await h.debug.setCursor(arm, 0);
  for (const write of WRITES) await pressAction(h, write);
  const edited = await h.snapshot();

  const undone: OrrerySnapshot[] = [];
  for (let i = 0; i < WRITES.length; i += 1) {
    await pressAction(h, "undo");
    undone.push(await h.snapshot());
  }

  await h.advance(1);
  await captureStill(h, "redo-side");

  assertEqual(
    edited.editor.undoDepth,
    posed.editor.undoDepth + WRITES.length,
    "each write to a tape pushes one entry, so three writes push three",
  );
  assertEqual(
    edited.editor.redoDepth,
    posed.editor.redoDepth,
    "committing edits puts nothing on the redo side",
  );

  for (const [step, snapshot] of undone.entries()) {
    assertEqual(
      snapshot.editor.redoDepth,
      posed.editor.redoDepth + step + 1,
      `undo ${step + 1} moved the edit it took onto the redo side`,
    );
    assertEqual(
      snapshot.editor.undoDepth,
      edited.editor.undoDepth - (step + 1),
      `undo ${step + 1} took exactly one entry off the undo side`,
    );
  }
});
