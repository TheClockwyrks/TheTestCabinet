// editor/tape-writes-are-inert-during-a-run — the tape-focus actions write nothing
// while a run is live.
//
// THE RULE. "While a run is active, in any status, a press on the field or the tape
// panel sets the focus alone, and the editor reads the run controls above and
// `mute` and nothing else" (`specs/editor.md`, Running the machine). The run
// controls above it are `play`, `step`, `speed-up`, `speed-down` and `back`, and
// `specs/controls.md` tabulates the same list — "`editor`, `running` or `paused` |
// `play`, `step`, `speed-up`, `speed-down`, `back`, `mute`" — under "An action a
// row omits does nothing on that screen." `ins-grab` is on the tape-focus row,
// which that list omits. `specs/simulation.md` agrees from the machine's side: "The
// editor's parts are locked for the whole run", and a tape is part of its part.
//
// WHAT `ins-grab` WOULD DO IF IT WERE READ is both halves of the reading. While
// editing, `specs/controls.md` binds `ins-grab` to `KeyG` and has it write `grab`
// at the cursor, and `specs/editor.md` completes it: "Each instruction action
// writes its instruction at the cursor and moves the cursor one cell right." So a
// build that read it would show it twice over — in the cell, and in
// `editor.cursor.col`.
//
// THE CONFIGURATION. `BARE` with one arm at `(0, 0)` whose tape is `["drop"]`, an
// empty field, and the cursor pointed at column `0` — the cell holding `drop`. The
// cell is posed NON-BLANK, and holding an instruction that is not the one
// `ins-grab` writes, so the write this point forbids would be visible as a changed
// cell rather than as a lengthened tape. `drop` is also inert here: "`drop` — Every
// gripper opens, releasing whatever it held", and the field holds no mote, so the
// run ticks on cycle after cycle without moving anything or faulting. The tape's
// reported length is `1` throughout, because "Its length is trimmed: the last entry
// is never `null`" (`specs/state.md`).
//
// THE HANDS ARE POSED ONCE THE RUN IS LIVE, through `setFocus` and `setCursor`,
// rather than before it: no sentence of `specs/` fixes whether a run start keeps
// the focus or the cursor, so a check that posed them while editing and read them
// back after would be deciding a rule the specification never wrote. The focus must
// be `tape` for this to be a reading at all — under `field` focus `KeyG` names no
// action, and the press would be inert for a reason that is not this one.
//
// THE VERDICT. After the `ins-grab` press, the cursor's cell still holds `drop`,
// the tape is still that one cell, and `editor.cursor.col` is still `0`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  openBareRun,
  partById,
  partIds,
  pressAction,
  type Harness,
} from "../harness";

/** The column the cursor is pointed at, and the cell `ins-grab` would overwrite. */
const CURSOR_COL = 0;

/** What that cell holds: an instruction that is not the one `ins-grab` writes. */
const CELL = "drop";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the cursor's cell and editor.cursor.col standing under ins-grab", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, [CELL])]),
  });
  const arm = (await partIds(h))[0] ?? -1;

  await h.debug.setFocus("tape");
  await h.debug.setCursor(arm, CURSOR_COL);

  const opened = await h.snapshot();
  assertEqual(
    opened.sim?.status,
    "running",
    "startRun leaves sim.status running, which is the status this point names",
  );
  assertEqual(
    opened.editor.focus,
    "tape",
    "the focus stands at tape, so the game reads the tape-focus actions",
  );
  assertEqual(
    opened.editor.cursor?.part,
    arm,
    "the cursor points at the arm's row before the press",
  );
  assertEqual(
    opened.editor.cursor?.col,
    CURSOR_COL,
    `the cursor points at column ${CURSOR_COL} before the press`,
  );
  assertDeepEqual(
    partById(opened, arm)?.tape,
    [CELL],
    `the cursor's cell holds ${CELL} before the press`,
  );

  await pressAction(h, "ins-grab");
  await captureStill(h, "inert-write");

  const snapshot = await h.snapshot();
  const part = partById(snapshot, arm);
  assertNotNull(part, "the arm is still in the machine after the press");
  assertEqual(
    part?.tape?.[CURSOR_COL],
    CELL,
    `ins-grab writes nothing at the cursor while the run is live: the cell still holds ${CELL}`,
  );
  assertDeepEqual(
    part?.tape,
    [CELL],
    "ins-grab lengthens no tape and writes into no other cell while the run is live",
  );
  assertEqual(
    snapshot.editor.cursor?.part,
    arm,
    "ins-grab leaves the cursor on the arm's row",
  );
  assertEqual(
    snapshot.editor.cursor?.col,
    CURSOR_COL,
    `ins-grab moves the cursor nowhere while the run is live: it stands at column ${CURSOR_COL}`,
  );
});
