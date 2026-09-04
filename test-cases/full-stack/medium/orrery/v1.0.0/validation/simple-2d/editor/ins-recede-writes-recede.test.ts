// editor/ins-recede-writes-recede — one press of `ins-recede` under tape focus puts
// `recede` in the cell the cursor stands on.
//
// THE RULE. "The tape-focus actions of `specs/controls.md` then edit at the cursor:
// Each instruction action writes its instruction at the cursor and moves the cursor
// one cell right" (`specs/editor.md`, The tape panel). Which instruction each
// action writes is `specs/controls.md`'s tape-focus table, whose row for `ins-recede`,
// bound to `KeyB`, names `recede`.
//
// THE CONFIGURATION. `BARE` opened in the editor with ONE arm and nothing else, so
// the panel has exactly one row and the cursor has one arm to stand on. The focus
// is set to `tape`, which is what the routing rule needs, and the cursor is pointed
// at column `2` rather than column `0`, so a build that wrote at the tape's start
// rather than at the cursor is caught. Any tape may carry any instruction —
// "`specs/instructions.md`: Any tape may carry any instruction, and an instruction
// the executing part cannot perform faults the run at the moment it is fetched" —
// so an arm is a fair row to write every one of the ten on, and nothing here runs.
//
// THE CELL IS READ BLANK FIRST, so what stands in it after the press is the press's
// doing rather than a value it inherited. `specs/instrumentation.md` reports a
// part's tape trimmed to its length, and an untouched arm's tape is entirely blank.
//
// THE VERDICT. The arm's cell at column `2` holds `recede`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  partById,
  placePart,
  pressAction,
  type Harness,
} from "../harness";

/** The column the cursor is pointed at: not the tape's first, so "at the cursor" bites. */
const COLUMN = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("writes recede at the cursor on one ins-recede press", async () => {
  await openChallengeDocument(h, BARE);
  const arm = await placePart(h, "arm", ORIGIN);
  await h.debug.setFocus("tape");
  await h.debug.setCursor(arm, COLUMN);

  const posed = await h.snapshot();
  assertEqual(
    posed.editor.focus,
    "tape",
    "the focus is on the tape, so the game reads the tape-focus actions",
  );
  assertEqual(
    posed.editor.cursor?.part,
    arm,
    "the cursor stands on the one arm's row",
  );
  assertEqual(
    posed.editor.cursor?.col,
    COLUMN,
    `the cursor stands on column ${COLUMN}`,
  );
  assertNull(
    partById(posed, arm)?.tape?.[COLUMN] ?? null,
    `column ${COLUMN} is blank before the press`,
  );

  await pressAction(h, "ins-recede");
  await captureStill(h, "written");

  const after = await h.snapshot();
  assertEqual(
    partById(after, arm)?.tape?.[COLUMN] ?? null,
    "recede",
    `one ins-recede press writes recede at the cursor, which stands on column ${COLUMN}`,
  );
});
