// editor/a-moved-arm-keeps-its-tape — a move carries an arm's or a wheel's tape
// with it, cell for cell, and leaves the tape panel's row order alone.
//
// THE RULE. "ARMS AND WHEELS KEEP THEIR TAPES, and mounting relationships are
// re-derived from position, as `specs/parts.md` states" (`specs/editor.md`,
// Dragging). The row the tape lives on is the same file's tape panel: "The panel
// shows ONE ROW PER ARM AND WHEEL, IN PLACEMENT ORDER", which
// `specs/instrumentation.md` reports as `editor.parts`, "placement order; the tape
// panel's row order". Moving a part is not placing one, so the order the parts
// were placed in is the order they stay in.
//
// WHAT A TAPE IS. `specs/instructions.md` makes a tape a list of cells that may
// hold blanks, and `specs/formats.md` trims it so "its last entry is an
// instruction". The arm's tape below is `grab`, a BLANK, `drop` — the blank is
// there so "in the same columns" is a reading rather than a coincidence: a build
// that kept the instructions but closed the gap would answer `grab`, `drop`.
//
// THE CONFIGURATION. `BARE` opened in the editor with two tape-carrying parts,
// placed in this order through the surface: an ARM on `WEST`, then a WHEEL on
// `EAST`, each given its tape cell by cell. Nothing else is on the field. The arm
// is moved from `WEST` to `NORTH` and then the wheel from `EAST` to `SOUTH`, both
// offsets landing on bare hexes that break none of the six placement rules, so
// both moves commit and the reading is about a move that happened.
//
// THE VERDICT. Each part's tape after its move is the tape it was given, cell for
// cell and column for column; the other part's tape is untouched; and
// `editor.parts` is still the arm then the wheel.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import type { InstructionName } from "../constants";
import { BARE, EAST, NORTH, SOUTH, WEST } from "../fixtures";
import {
  captureStill,
  createHarness,
  dragHex,
  openChallengeDocument,
  partById,
  partIds,
  placePart,
  writeTape,
  type Harness,
} from "../harness";

/** The arm's tape: two instructions with a blank between them. */
const ARM_TAPE: readonly (InstructionName | null)[] = ["grab", null, "drop"];

/** The wheel's tape, so the check reads a wheel's row as well as an arm's. */
const WHEEL_TAPE: readonly (InstructionName | null)[] = ["rotate-cw"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries each tape through its move and keeps the rows in placement order", async () => {
  await openChallengeDocument(h, BARE);
  const arm = await placePart(h, "arm", WEST);
  const wheel = await placePart(h, "wheel", EAST);
  await writeTape(h, arm, ARM_TAPE);
  await writeTape(h, wheel, WHEEL_TAPE);
  assertDeepEqual(
    await partIds(h),
    [arm, wheel],
    "the arm was placed before the wheel, so that is the panel's row order to begin with",
  );

  await dragHex(h, WEST, NORTH);
  const afterArm = await h.snapshot();
  assertEqual(
    `${partById(afterArm, arm)?.q},${partById(afterArm, arm)?.r}`,
    `${NORTH.q},${NORTH.r}`,
    "the arm's move committed, so what follows reads a tape that travelled",
  );
  assertDeepEqual(
    partById(afterArm, arm)?.tape,
    [...ARM_TAPE],
    "the moved arm holds the instructions it held, in the columns it held them",
  );

  await dragHex(h, EAST, SOUTH);
  await h.advance(1);
  await captureStill(h, "tape");

  const afterWheel = await h.snapshot();
  assertEqual(
    `${partById(afterWheel, wheel)?.q},${partById(afterWheel, wheel)?.r}`,
    `${SOUTH.q},${SOUTH.r}`,
    "the wheel's move committed too",
  );
  assertDeepEqual(
    partById(afterWheel, wheel)?.tape,
    [...WHEEL_TAPE],
    "and the moved wheel holds its tape the same way",
  );
  assertDeepEqual(
    partById(afterWheel, arm)?.tape,
    [...ARM_TAPE],
    "the arm's tape is still what it was: an edit changes the edited part alone",
  );
  assertDeepEqual(
    await partIds(h),
    [arm, wheel],
    "and both rows keep their place in placement order across the two moves",
  );
});
