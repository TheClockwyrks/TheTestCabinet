// instrumentation/set-cursor — the operation that points the tape cursor at a
// cell.
//
// THE RULE. "`setCursor(part, col)` | Points the tape cursor at column `col` of
// that part's row, a whole number of at least `0`"
// (`specs/instrumentation.md`, The editor's hands), reported by the snapshot as
// `editor.cursor`, `{ part: <number>, col: <number> } | null`. What the cursor
// DECIDES is `specs/editor.md`: "The tape-focus actions of `specs/controls.md`
// then edit at the cursor: Each instruction action writes its instruction at the
// cursor".
//
// SO THE CHECK READS THE HAND AND THEN THE CONSEQUENCE. `editor.cursor` names the
// posed part and the posed column, and the instruction action a player presses
// under tape focus — `ins-grab`, `KeyG`, writing `grab` (`specs/controls.md`) —
// lands in THAT cell of THAT row and in no other. The cell it lands in is read
// off the tape the snapshot reports, whose cells "between the tape's end and
// `col` become blanks" and which is trimmed as `specs/formats.md` trims one: "Its
// last entry is an instruction, and an entirely blank tape is the empty list." So
// a `grab` at column three is `[null, null, null, "grab"]`, and the arm the cursor
// does not name is still holding the empty tape it was placed with.
//
// THE COLUMN IS INSIDE THE PANEL'S OWN WIDTH. `TAPE_COLS_VISIBLE` is `40` and
// `firstCol = max(0, cursor.col - (TAPE_COLS_VISIBLE - 1))` (`specs/editor.md`),
// so a cursor at column three is shown without the panel scrolling at all; the
// still is the evidence for where it is drawn.
//
// THE WORLD IS POSED, NOT SEARCHED. A posed challenge, an empty machine, and two
// arms — two, because "that part's row" says nothing on a machine holding one —
// with the focus posed to `tape`, which is the focus the instruction actions are
// read under. No run is started: the cursor is an editing hand.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  partById,
  placePart,
  pressAction,
  type Harness,
} from "../harness";
import { BARE, EAST, ORIGIN } from "../fixtures";

/** The column the cursor is posed at: inside the panel's `TAPE_COLS_VISIBLE`. */
const COLUMN = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("points the cursor at that part's row and column, and the write lands there", async () => {
  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();
  const first = await placePart(h, "arm", ORIGIN, 0);
  const second = await placePart(h, "arm", EAST, 0);
  await h.debug.setFocus("tape");

  await h.debug.setCursor(second, COLUMN);
  const posed = await h.snapshot();
  assertNotNull(posed.editor.cursor, "setCursor points the cursor at a cell");
  assertEqual(
    posed.editor.cursor?.part,
    second,
    "setCursor(part, col) points the cursor at that part's row",
  );
  assertEqual(
    posed.editor.cursor?.col,
    COLUMN,
    "setCursor(part, col) points the cursor at column col",
  );

  await pressAction(h, "ins-grab");
  await captureStill(h, "cursor");

  const written = await h.snapshot();
  const edited = partById(written, second);
  assertNotNull(edited, "the cursor's arm is still on the machine");
  assertDeepEqual(
    edited?.tape,
    [...Array.from({ length: COLUMN }, () => null), "grab"],
    "an instruction action writes into the cell the cursor names, the cells before it left blank",
  );
  const other = partById(written, first);
  assertNotNull(other, "the other arm is still on the machine");
  assertDeepEqual(
    other?.tape,
    [],
    "the write lands in the row the cursor names and in no other",
  );
});
