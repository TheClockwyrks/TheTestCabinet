// editor/a-lay-that-changed-nothing-pushes-no-entry — a lay that appended and
// removed nothing commits nothing.
//
// THE RULE. The history's unit is "ending a lay that CHANGED a track", and the
// sentence that follows makes the omission explicit: "An edit that changes
// nothing, such as writing the instruction a cell already holds, commits nothing
// and pushes no entry" (`specs/editor.md`, Undo and redo).
//
// THE GESTURE. "A press on an end cell of an open track begins laying rather than
// moving... The release ends the lay, leaving the path as laid" (`specs/editor.md`,
// Laying track). Pressing and releasing on the same end cell walks the pointer
// onto no hex at all, so nothing is appended and nothing is removed, and the path
// the release leaves is the path the press found.
//
// THE CONFIGURATION. A three-cell open track running east from `(-2, 0)`, and
// nothing else on the field. The press lands on `(0, 0)`, its `last` end, and the
// release follows with no move between them.
//
// THE PRESS IS READ AS WELL AS THE RELEASE. A build that began no lay at all would
// also leave the depth alone, and would pass a check that only counted entries. So
// the drag the press opened is read first: it is a `lay` on the track, which is
// what makes the release afterwards the ending of a lay rather than nothing
// happening.
//
// THE VERDICT. `editor.undoDepth` reads exactly what it read before the press, and
// the track's path is untouched.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { at, hexCenter } from "../field";
import { solution, trackPart } from "../formats";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadMachine,
  openChallengeDocument,
  pressAt,
  releasePointer,
  solePartOfKind,
  type Harness,
} from "../harness";

/** The track's path, which the press must leave exactly as it found it. */
const CELLS = [at(-2, 0), at(-1, 0), at(0, 0)];

/** The `last` end of that path: where a press begins a lay. */
const END = CELLS[2] ?? at(0, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the undo depth exactly as it stands when the lay changed nothing", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(h, solution([trackPart(CELLS)]));

  const posed = await h.snapshot();

  await pressAt(h, hexCenter(END));
  const pressed = await h.snapshot();
  await releasePointer(h);
  const released = await h.snapshot();

  await h.advance(1);
  await captureStill(h, "unchanged");

  assertDeepEqual(
    solePartOfKind(posed, "track")?.cells,
    CELLS,
    "the track stands with the three cells it was given",
  );
  assertEqual(
    pressed.editor.drag?.kind,
    "lay",
    "the press on the track's end began a lay, so the release ends one",
  );
  assertEqual(
    released.editor.drag,
    null,
    "the release ended the lay: a drag ends at its release",
  );
  assertDeepEqual(
    solePartOfKind(released, "track")?.cells,
    CELLS,
    "the lay walked onto no hex, so the path is the path the press found",
  );
  assertEqual(
    released.editor.undoDepth,
    posed.editor.undoDepth,
    "an edit that changes nothing commits nothing and pushes no entry",
  );
  assertEqual(
    released.editor.redoDepth,
    posed.editor.redoDepth,
    "and with nothing committed there is nothing on the redo side either",
  );
});
