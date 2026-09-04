// editor/redo-with-empty-history-does-nothing — with nothing waiting on the redo
// side, the key is inert.
//
// THE RULE. `undo` and `redo` "both act only while editing and on the open
// challenge's machine alone, DO NOTHING WITH EMPTY HISTORY" (`specs/editor.md`,
// Undo and redo), and what `redo` would otherwise do is "re-applies the latest
// undone edit" — with nothing undone there is no such edit.
// `specs/instrumentation.md` reports what must not move: `editor.parts`,
// `editor.undoDepth` and `editor.redoDepth`.
//
// THE UNDO SIDE IS DELIBERATELY NOT EMPTY. The item is about a redo with nothing
// UNDONE, so the scenario commits an edit first and undoes none of it: the undo
// side holds one entry and the redo side holds nothing. A build that answered
// `redo` out of the undo history would take that entry back, which is exactly what
// the reading catches — and a check posed on a wholly empty history could not
// catch it.
//
// THE CONFIGURATION. One arm at `(0, 0)` with an EMPTY tape, alone on the field,
// and one write at the cursor — `ins-grab` (`specs/controls.md`) — landing on a
// blank cell, so it changes the tape and "pushes one entry onto the undo history".
//
// THE VERDICT. `editor.redoDepth` reads `0` before the press and after it,
// `editor.undoDepth` still reads the one entry the write pushed, and
// `editor.parts` is exactly what the write left.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
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
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the machine, the undo side and the redo side exactly as they stand", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, [])]),
  );

  const posed = await h.snapshot();
  assertNotNull(
    solePartOfKind(posed, "arm"),
    "the machine stands with one arm for the write to land on",
  );

  await h.debug.setFocus("tape");
  await h.debug.setCursor(solePartOfKind(posed, "arm")?.id ?? -1, 0);
  await pressAction(h, "ins-grab");
  const before = await h.snapshot();

  await pressAction(h, "redo");
  const after = await h.snapshot();

  await h.advance(1);
  await captureStill(h, "inert");

  assertEqual(
    before.editor.undoDepth,
    posed.editor.undoDepth + 1,
    "the write changed a blank cell, so it pushed one entry onto the undo side",
  );
  assertEqual(
    before.editor.redoDepth,
    0,
    "and with nothing undone the redo side is empty",
  );

  assertDeepEqual(
    after.editor.parts,
    before.editor.parts,
    "a redo with an empty redo side leaves editor.parts exactly as it stands",
  );
  assertEqual(
    after.editor.redoDepth,
    0,
    "and leaves editor.redoDepth exactly as it stands",
  );
  assertEqual(
    after.editor.undoDepth,
    before.editor.undoDepth,
    "and takes nothing off the undo side, which is not the redo side",
  );
});
