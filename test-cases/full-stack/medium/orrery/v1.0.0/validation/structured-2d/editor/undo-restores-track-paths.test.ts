// editor/undo-restores-track-paths — an entry holds the parts with their paths, so
// one undo past a lay puts the path back.
//
// THE RULE. "The entry holds the machine as it stood before the edit: the parts
// with their poses, PATHS, and tapes", restored by "The `undo` action restores the
// machine from the latest entry" (`specs/editor.md`, Undo and redo). The path is
// what the snapshot calls a track's `cells` and `closed`
// (`specs/instrumentation.md`), and the two are fields of one snapshotted track —
// a lay that changed the cells is the same lay that could have closed the ring —
// so they are read together rather than as separate points. The edit that disturbs
// a path comes from the same file's list of committed edits: "ending a lay that
// changed a track".
//
// THE CONFIGURATION IS THE PATH AND NOTHING ELSE. A two-cell open track running
// east from `(-2, 2)`, and an arm at `(0, 0)` off it whose anchor is on no track
// cell, so nothing is mounted and the lay reaches no part it was not aimed at.
// What an entry does for a part's pose is `undo-restores-poses`, and for an arm's
// tape `undo-restores-tapes`; each poses its own world and stages its own single
// edit, so no one of the three can only pass while the other two commit.
//
// THE EDIT, through the surface's pointer because "None [of the machine
// operations] pushes an undo entry" (`specs/instrumentation.md`): a lay off the
// track's `last` end onto two further hexes, ended by the release. It is read
// before it is undone, so a build that committed nothing cannot pass by having
// nothing to restore.
//
// THE VERDICT. After one undo the track holds exactly the two cells it was posed
// with, in their posed order, and is still open, and the one entry the lay pushed
// is the one the undo took.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNotEqual,
  assertNotNull,
} from "../assert";
import type { InstructionName } from "../constants";
import { at, hexCenter } from "../field";
import { armPart, solution, trackPart } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
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

/** The track's path as posed, and the hexes the lay appends to it. */
const TRACK_CELLS = [at(-2, 2), at(-1, 2)];
const APPENDED = [at(0, 2), at(1, 2)];

/** The arm standing off the track, which the lay must leave where it is. */
const ARM_ROTATION = 4;
const ARM_LENGTH = 2;
const ARM_TAPE: readonly InstructionName[] = ["grab", "rotate-cw"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("restores the track's cells and closed flag after an undone lay", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([
      armPart("arm", ORIGIN.q, ORIGIN.r, ARM_ROTATION, ARM_LENGTH, ARM_TAPE),
      trackPart(TRACK_CELLS),
    ]),
  );

  const readings = await captureReplay(h, "restored", async () => {
    const posed = await h.snapshot();

    await pressAt(h, hexCenter(TRACK_CELLS[1] ?? at(0, 0)));
    for (const cell of APPENDED) await moveTo(h, hexCenter(cell));
    await releasePointer(h);
    const edited = await h.snapshot();

    await pressAction(h, "undo");
    const undone = await h.snapshot();

    return { posed, edited, undone };
  });

  const { posed, edited, undone } = readings;
  assertEqual(
    edited.editor.undoDepth,
    posed.editor.undoDepth + 1,
    "the lay is one committed edit",
  );
  assertNotEqual(
    solePartOfKind(edited, "track")?.cells?.length,
    TRACK_CELLS.length,
    "the lay was committed, so the undo has a path to restore",
  );

  const track = solePartOfKind(undone, "track");
  assertNotNull(track, "the track is on the field after the undo");

  assertDeepEqual(
    track?.cells,
    TRACK_CELLS,
    "an entry holds each track's cells",
  );
  assertEqual(track?.closed, false, "an entry holds each track's closed flag");
  assertEqual(
    undone.editor.undoDepth,
    posed.editor.undoDepth,
    "and the one entry the lay pushed is the one the undo took",
  );
});
