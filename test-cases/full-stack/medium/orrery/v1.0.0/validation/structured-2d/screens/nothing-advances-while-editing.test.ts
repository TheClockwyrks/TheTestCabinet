// screens/nothing-advances-while-editing — the editor with no run live is still:
// game time passes and the machine, the selection, the cursor and both histories
// stand exactly where the last edit left them.
//
// THE RULE. `specs/ui.md` tabulates what each screen advances under What advances
// on each screen, and the editor's row names exactly one thing: "The run, while
// `sim.status` is `running`, as `specs/simulation.md` defines." With no run live
// there is nothing on that row, so the editor advances nothing at all. The one
// figure the table does not cover is stated in the line above it:
// "`state.simTime` accumulates the frame's delta time on every update, whatever
// the screen", which `specs/instrumentation.md` repeats over the snapshot:
// "`simTime` accumulates the delta time of every update, whatever the screen".
//
// The editing state the item names is state the player owns:
// `specs/instrumentation.md` reports `editor` as the machine's `parts` with the
// derived `cost` and `period`, the `selected` part, the `focus`, the `cursor`, the
// live `drag`, and `undoDepth` and `redoDepth`, and `specs/editor.md` fixes what
// moves each of them — a placement, a press, a key. Passing time is none of those.
//
// THE POSE. `BARE` open in the editor with ONE arm on it, posed away from the
// values a fresh placement carries — rotation `2` and length `ARM_MAX_LEN` (`3`)
// rather than the `0` and `1` `placePart` gives — and carrying a tape, so `cost`,
// `period` and the part's own facts are all readings of something. Both histories
// are then filled through the KEYBOARD, which is the only thing that fills them:
// "None pushes an undo entry, so `undoDepth` and `redoDepth` move under edits made
// through the pointer and the keys alone" (`specs/instrumentation.md`). Two tape
// writes at the cursor and one `undo` leave one entry on each side, so neither
// depth is being read at zero. The selection and the cursor are posed last.
//
// NO RUN IS LIVE, which is the whole condition of the item: `sim` reports `null`
// while editing, and the check reads that before and after so the drive is
// unambiguously the editing case rather than the running one.
//
// THE DRIVE. `SECONDS` (`6`) of game time, divided into `FRAMES` (`180`) whole
// frames — many times the span any of `SPEEDS` needs to turn a cycle, so a build
// that ran this machine's tape without a run would show it many times over.
//
// THE VERDICT. Field by field, `editor` reports exactly what it reported before
// the drive; `sim` is still `null`; the screen is still `editor`; and `simTime`
// has risen by exactly the span of game time that passed. That last reading is a
// NEAR one: `specs/instrumentation.md` carries `simTime` as a running sum of the
// frames' own delta times, which "agree to within the rounding of that sum rather
// than bit for bit", so it is never read for equality.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNear,
  assertNotNull,
  assertNull,
} from "../assert";
import { ARM_MAX_LEN, FRACTION_TOLERANCE } from "../constants";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureReplay,
  createHarness,
  loadMachine,
  openChallengeDocument,
  pressAction,
  solePartOfKind,
  type EditorView,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

/** The span of game time the editor is left to run for, and its frames. */
const SECONDS = 6;
const FRAMES = 180;

/** The arm's posed rest pose, away from what a fresh placement carries. */
const REST_ROTATION = 2;
const REST_LENGTH = ARM_MAX_LEN;

/** The column the two keyboard writes land at, and the one after it. */
const FIRST_COLUMN = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * Every field of `editor` stands exactly as it stood.
 *
 * Read field by field rather than as one deep comparison of the whole record, so
 * a build that advanced one figure fails naming that figure. The field LIST is
 * compared as well, so a field that went missing or appeared is caught too.
 */
function assertEditorHeld(after: EditorView, before: EditorView): void {
  const names = (view: EditorView): string[] => Object.keys(view).sort();
  assertDeepEqual(
    names(after),
    names(before),
    "the editor reports the same fields after six seconds of game time",
  );
  for (const key of names(before)) {
    assertDeepEqual(
      (after as unknown as Record<string, unknown>)[key],
      (before as unknown as Record<string, unknown>)[key],
      `editor.${key} over six seconds with no run live`,
    );
  }
}

it("holds the machine, the hands and both histories while the editor runs with no run", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([
      armPart(
        "arm",
        ORIGIN.q,
        ORIGIN.r,
        REST_ROTATION,
        REST_LENGTH,
        ["grab", "rotate-cw"],
      ),
    ]),
  );

  const posed: OrrerySnapshot = await h.snapshot();
  const arm = solePartOfKind(posed, "arm");
  assertNotNull(arm, "the machine stands with the one arm the check posed");
  const armId = arm?.id ?? -1;

  // Both histories, filled the one way that fills them: edits through the keys.
  await h.debug.setFocus("tape");
  await h.debug.setCursor(armId, FIRST_COLUMN);
  await pressAction(h, "ins-drop");
  await pressAction(h, "ins-rotate-ccw");
  await pressAction(h, "undo");
  await h.debug.setSelected(armId);

  const before = await h.snapshot();
  assertEqual(before.screen, "editor", "the drive runs on the editor screen");
  assertNull(
    before.sim,
    "no run is live, which is the condition the item is about",
  );
  assertEqual(before.editor.parts.length, 1, "one arm stands on the field");
  assertEqual(before.editor.selected, armId, "and it is the selected part");
  assertNotNull(
    before.editor.cursor,
    "the tape cursor points at a cell, so holding it reads something",
  );
  assertEqual(
    before.editor.undoDepth,
    1,
    "two keyboard writes and one undo leave one entry on the undo side",
  );
  assertEqual(
    before.editor.redoDepth,
    1,
    "and one on the redo side, so neither depth is read at zero",
  );

  await captureReplay(h, "held", () => h.advanceSeconds(SECONDS, FRAMES));

  const after = await h.snapshot();
  assertEqual(
    after.screen,
    "editor",
    "the game is still on the editor after the drive",
  );
  assertNull(
    after.sim,
    "no run started itself: the editor's row advances the run and nothing else",
  );
  assertEditorHeld(after.editor, before.editor);
  assertNear(
    after.simTime - before.simTime,
    SECONDS,
    FRACTION_TOLERANCE,
    "simTime accumulates the frame's delta time on the editor like any screen",
  );
});
