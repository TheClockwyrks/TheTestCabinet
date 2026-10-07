// editor/each-tape-write-pushes-one-entry — a tape write is one edit per cell, and
// undos take them back one at a time.
//
// THE RULE. "Every committed edit to the machine pushes one entry onto the undo
// history: placing, moving, or deleting a part, ending a lay that changed a track,
// rotating or resizing a part, and EACH WRITE TO A TAPE, the macros counting as
// one edit apiece" (`specs/editor.md`, Undo and redo). So three instruction
// actions are three edits, and "The `undo` action restores the machine from the
// latest entry" takes them back one at a time rather than as a group.
//
// HOW THE WRITES ARE DRIVEN. "The tape-focus actions of `specs/controls.md` then
// edit at the cursor: each instruction action writes its instruction at the cursor
// and moves the cursor one cell right" (`specs/editor.md`, The tape panel), and
// `specs/controls.md` binds `ins-grab` to `KeyG`, `ins-rotate-cw` to `KeyD` and
// `ins-drop` to `KeyV`. So one press per cell, from column `0`, with the cursor
// carried along by the writes themselves.
//
// THE CONFIGURATION. One arm at `(0, 0)` with an EMPTY tape, alone on the field.
// Every one of the three writes therefore changes the cell it lands on — a blank
// becomes an instruction — which is what makes each of them a committed edit
// rather than the no-op a separate item is about. The three instructions differ
// from one another, so each undo has a distinct value to reveal.
//
// THE TAPE IS READ AS COLUMNS. "A cell at or past the tape's own length is blank"
// (`specs/instructions.md`), and `specs/formats.md` trims a tape's trailing blanks,
// so undoing the third write leaves a tape of two cells rather than three with a
// blank at the end; a column is read as the cell it holds or as a blank.
//
// THE VERDICT. `editor.undoDepth` rises by exactly `3` across the three presses,
// and the three undos reveal `[grab, rotate-cw]`, then `[grab]`, then a tape with
// nothing on it, with the depth falling by one each time.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import type { ActionName, InstructionName } from "../constants";
import { armPart, solution } from "../formats";
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
  type OrrerySnapshot,
} from "../harness";

/** The three actions pressed, and the instruction each writes. */
const PRESSES: readonly { action: ActionName; writes: InstructionName }[] = [
  { action: "ins-grab", writes: "grab" },
  { action: "ins-rotate-cw", writes: "rotate-cw" },
  { action: "ins-drop", writes: "drop" },
];

/** How many columns of the tape are read, one past the last the writes reach. */
const COLUMNS = PRESSES.length + 1;

/**
 * The tape's first {@link COLUMNS} columns, as columns rather than as a trimmed
 * list: a column past the tape's length reads as the blank it holds.
 */
function columnsOf(
  snapshot: OrrerySnapshot,
  part: number,
): (InstructionName | null)[] {
  const tape = partById(snapshot, part)?.tape ?? [];
  return Array.from({ length: COLUMNS }, (_unused, i) => tape[i] ?? null);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises the undo depth by three, and three undos restore the tape one cell at a time", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, [])]),
  );

  const readings = await captureReplay(h, "undone", async () => {
    const posed = await h.snapshot();
    const arm = solePartOfKind(posed, "arm")?.id ?? -1;
    await h.debug.setFocus("tape");
    await h.debug.setCursor(arm, 0);

    for (const press of PRESSES) await pressAction(h, press.action);
    const written = await h.snapshot();

    const undone: OrrerySnapshot[] = [];
    for (let i = 0; i < PRESSES.length; i += 1) {
      await pressAction(h, "undo");
      undone.push(await h.snapshot());
    }

    return { posed, arm, written, undone };
  });

  const { posed, arm, written, undone } = readings;
  assertNotNull(
    solePartOfKind(posed, "arm"),
    "the machine stands with one arm for the writes to land on",
  );
  assertDeepEqual(
    columnsOf(posed, arm),
    [null, null, null, null],
    "the arm carries an empty tape, so every write changes the cell it lands on",
  );

  assertDeepEqual(
    columnsOf(written, arm),
    [...PRESSES.map((press) => press.writes), null],
    "each instruction action wrote its instruction and moved the cursor one cell right",
  );
  assertEqual(
    written.editor.undoDepth,
    posed.editor.undoDepth + PRESSES.length,
    "each write to a tape pushes one entry, so three writes push three",
  );

  const expected: (InstructionName | null)[][] = [
    ["grab", "rotate-cw", null, null],
    ["grab", null, null, null],
    [null, null, null, null],
  ];
  for (const [step, snapshot] of undone.entries()) {
    assertNotNull(
      solePartOfKind(snapshot, "arm"),
      `the arm is still on the field after undo ${step + 1}`,
    );
    assertDeepEqual(
      columnsOf(snapshot, arm),
      expected[step],
      `undo ${step + 1} takes back the write at column ${PRESSES.length - 1 - step} and no other`,
    );
    assertEqual(
      snapshot.editor.undoDepth,
      posed.editor.undoDepth + PRESSES.length - (step + 1),
      `undo ${step + 1} takes exactly one entry off the history`,
    );
  }
});
