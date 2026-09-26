// editor/an-instruction-write-advances-the-cursor — a write leaves the cursor one
// cell right of where it wrote, on the row it wrote on.
//
// THE RULE. "Each instruction action writes its instruction at the cursor and
// moves the cursor one cell right" (`specs/editor.md`, The tape panel). The
// snapshot carries the hand as `editor.cursor`, "`{ part: <number>, col: <number> }
// | null`" (`specs/instrumentation.md`), so "one cell right" is `col` one higher
// and "the row it wrote on" is the same `part`.
//
// WHAT THE ITEM DECIDES IS THE ADVANCE, NOT THE NAME. Which instruction each
// action writes is decided one item apiece; what this one reads is that the cursor
// MOVED, and that three presses therefore fill three CONSECUTIVE cells rather than
// piling into one. So the cells are read as written-or-blank rather than by name:
// columns `0`, `1` and `2` each hold an instruction and column `3` is still blank.
//
// THE CONFIGURATION. Two arms, so "its part is unchanged" is a claim that can
// fail: the panel "shows one row per arm and wheel, in placement order"
// (`specs/editor.md`), and the cursor is pointed at the FIRST of the two, at column
// `0` of an empty tape, while a second row stands beside it. Three different
// instruction actions are pressed, so a build that advanced on one action and not
// on another is caught by whichever one it is.
//
// THE VERDICT. `editor.cursor` reads column `1`, then `2`, then `3`, naming the
// same arm throughout, and the tape holds an instruction in each of columns `0` to
// `2` with column `3` blank.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { RECORDING_RUN_UP, RECORDING_SETTLE } from "../constants";
import type { InstructionName } from "../constants";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  captureReplay,
  createHarness,
  loadMachine,
  openChallengeDocument,
  partById,
  partIds,
  pressAction,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * The tape's columns `from` onward, as columns rather than as a trimmed list.
 *
 * "A cell at or past the tape's own length is blank" (`specs/instructions.md`),
 * and `specs/formats.md` trims a tape's trailing blanks away, so a column is read
 * as the cell it holds or as a blank.
 */
function cellsAt(
  snapshot: OrrerySnapshot,
  part: number,
  from: number,
  count: number,
): (InstructionName | null)[] {
  const tape = partById(snapshot, part)?.tape ?? [];
  return Array.from({ length: count }, (_unused, i) => tape[from + i] ?? null);
}

it("moves the cursor one cell right per write, filling three consecutive cells", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([armPart("arm", 0, 0, 0, 1, []), armPart("arm", 3, 0, 0, 1, [])]),
  );
  const arm = (await partIds(h))[0] ?? -1;

  await h.debug.setFocus("tape");
  await h.debug.setCursor(arm, 0);

  const written = await captureReplay(h, "advanced", async () => {
    await h.advance(RECORDING_RUN_UP);
    const first = await pressAction(h, "ins-grab");
    const second = await pressAction(h, "ins-drop");
    const third = await pressAction(h, "ins-rotate-cw");
    await h.advance(RECORDING_SETTLE);
    return [first, second, third];
  });

  const columns = [1, 2, 3];
  for (const [step, snapshot] of written.entries()) {
    const cursor = snapshot.editor.cursor;
    assertNotNull(
      cursor,
      `the cursor is still pointing at a cell after write ${step + 1}`,
    );
    assertEqual(
      cursor?.part,
      arm,
      "a write leaves the cursor on the row it wrote on",
    );
    assertEqual(
      cursor?.col,
      columns[step],
      `write ${step + 1} moves the cursor one cell right of where it wrote`,
    );
  }

  const end = written[2] as OrrerySnapshot;
  const filled = cellsAt(end, arm, 0, 4);
  for (const column of [0, 1, 2]) {
    assertNotNull(
      filled[column],
      `column ${column} holds one of the three instructions written, so the three landed in consecutive cells`,
    );
  }
  assertDeepEqual(
    filled.slice(3),
    [null],
    "and column 3 is the first the three writes did not reach",
  );
});
