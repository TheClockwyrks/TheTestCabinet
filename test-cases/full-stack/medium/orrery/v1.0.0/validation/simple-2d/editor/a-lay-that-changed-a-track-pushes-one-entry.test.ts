// editor/a-lay-that-changed-a-track-pushes-one-entry — a lay is one edit however
// many cells it appended, and one undo takes the whole lay back.
//
// THE RULE. "Every committed edit to the machine pushes one entry onto the undo
// history: placing, moving, or deleting a part, ending a lay that changed a track,
// rotating or resizing a part, and each write to a tape" — so the unit is the LAY,
// not the cell — and "The entry holds the machine as it stood before the edit: the
// parts with their poses, paths, and tapes", restored by "The `undo` action
// restores the machine from the latest entry" (`specs/editor.md`, Undo and redo).
//
// HOW THE LAY IS DRIVEN comes from Laying track: "A press on an end cell of an
// open track begins laying rather than moving. While laying, moving the pointer
// onto a hex adjacent to the live end appends it to the path when the placement
// rules allow, and that hex becomes the live end... The release ends the lay,
// leaving the path as laid." `specs/instrumentation.md` puts the three pointer
// operations on the same input path the player's pointer feeds, and each takes
// effect at the call.
//
// THE CONFIGURATION. A two-cell open track running east from `(-2, 0)`, and
// nothing else on the field. The press lands on `(-1, 0)`, its `last` end; three
// moves visit `(0, 0)`, `(1, 0)` and `(2, 0)`, each adjacent to the live end and
// each a hex no other part occupies, so all three are appended; the release ends
// the lay. THREE cells is the point of the figure: a build that pushed one entry
// per appended cell would leave the depth three higher rather than one, and one
// undo would then hand back a four-cell path rather than the two the press began
// with.
//
// THE DEPTH IS READ AS A RISE, NOT AS A VALUE, because what the history holds when
// the scenario is posed belongs to the operations that posed it, and
// `specs/instrumentation.md` says none of them pushes an entry.
//
// THE VERDICT. The press opens a `lay` drag; the release leaves the five-cell
// path; `editor.undoDepth` rises by exactly `1`; and one undo returns the track to
// the two cells it held before the press.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { RECORDING_RUN_UP, RECORDING_SETTLE } from "../constants";
import { at, hexCenter } from "../field";
import { solution, trackPart } from "../formats";
import { BARE } from "../fixtures";
import {
  captureReplay,
  createHarness,
  loadMachine,
  moveTo,
  openChallengeDocument,
  pressAction,
  pressAt,
  releasePointer,
  solePartOfKind,
  type Harness,
} from "../harness";

/** The path the track holds before the press. */
const LAID = [at(-2, 0), at(-1, 0)];

/** The three hexes the lay walks onto, in order. */
const APPENDED = [at(0, 0), at(1, 0), at(2, 0)];

/** The path the release has to leave behind. */
const EXTENDED = [...LAID, ...APPENDED];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises the undo depth by one for the whole lay, and one undo takes all three cells back", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(h, solution([trackPart(LAID)]));

  const readings = await captureReplay(h, "undone", async () => {
    await h.advance(RECORDING_RUN_UP);
    const posed = await h.snapshot();

    await pressAt(h, hexCenter(LAID[1] ?? at(0, 0)));
    const pressed = await h.snapshot();
    for (const cell of APPENDED) await moveTo(h, hexCenter(cell));
    await releasePointer(h);
    const laid = await h.snapshot();

    await pressAction(h, "undo");
    const undone = await h.snapshot();

    await h.advance(RECORDING_SETTLE);
    return { posed, pressed, laid, undone };
  });

  const { posed, pressed, laid, undone } = readings;
  assertDeepEqual(
    solePartOfKind(posed, "track")?.cells,
    LAID,
    "the track stands with the two cells it was given",
  );
  assertEqual(
    pressed.editor.drag?.kind,
    "lay",
    "a press on an end cell of an open track begins laying rather than moving",
  );

  assertNotNull(
    solePartOfKind(laid, "track")?.cells,
    "the track is still on the field once the lay has ended",
  );
  assertDeepEqual(
    solePartOfKind(laid, "track")?.cells,
    EXTENDED,
    "the lay appended each of the three hexes the pointer visited, in order",
  );
  assertEqual(
    laid.editor.undoDepth,
    posed.editor.undoDepth + 1,
    "ending a lay that changed a track pushes ONE entry, not one per appended cell",
  );

  assertNotNull(
    solePartOfKind(undone, "track")?.cells,
    "the track is still on the field after the undo",
  );
  assertDeepEqual(
    solePartOfKind(undone, "track")?.cells,
    LAID,
    "one undo returns the track to the path it held before the press",
  );
  assertEqual(
    undone.editor.undoDepth,
    posed.editor.undoDepth,
    "and the one entry the lay pushed is the one the undo took",
  );
});
