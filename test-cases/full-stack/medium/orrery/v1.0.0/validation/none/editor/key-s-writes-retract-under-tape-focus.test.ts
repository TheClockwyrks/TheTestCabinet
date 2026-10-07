// editor/key-s-writes-retract-under-tape-focus — one physical key, two
// registered actions, and the focus decides which of them the editor reads.
// This point reads the tape-focus half.
//
// THE RULE. "Two focus-routed actions share a physical key: `part-grow` and
// `ins-extend` on `KeyW`, and `part-shrink` and `ins-retract` on `KeyS`. Each
// is registered on its own, and the game reads the ones the current focus
// names" (`specs/controls.md`, Focus). What `ins-retract` does is fixed by the
// same file: `ins-retract` writes `retract` at the cursor, which
// `specs/editor.md` completes: "Each instruction action writes its instruction
// at the cursor".
//
// THE VERDICT IS ONE DIRECTION OF THE ROUTING. Under `tape` focus the press
// must reach the tape and NOT the arm, and both halves of that sentence are the
// one decision this point makes: a key routed to the other action fails on the
// first, and a key wired to both fails on the second. The opposite direction is
// `key-s-shrinks-the-arm-under-field-focus`, and neither point stands on the
// other — this one poses its own arm and reads it after its own single press.
//
// THE CONFIGURATION. One arm at the origin, selected, at length `2` — above
// `ARM_MIN_LEN` (`1`), so an arm this press shrank wrongly would have somewhere
// to shrink to — carrying two cells, with the cursor on column `0`. `retract`
// is a name the posed tape does not carry, so a cell holding it afterwards was
// written by this press and by nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import type { InstructionName } from "../constants";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  captureStill,
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

/** The cell at `col`, read as a column rather than out of a trimmed list. */
function cellAt(
  snapshot: OrrerySnapshot,
  part: number,
  col: number,
): InstructionName | null {
  return (partById(snapshot, part)?.tape ?? [])[col] ?? null;
}

it("writes retract at the cursor under tape focus", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([armPart("arm", 0, 0, 0, 2, ["grab", "drop"])]),
  );
  const arm = (await partIds(h))[0] ?? -1;

  await h.debug.setSelected(arm);
  await h.debug.setCursor(arm, 0);
  await h.debug.setFocus("tape");

  const posed = await h.snapshot();
  assertEqual(
    posed.editor.selected,
    arm,
    "the arm is selected, so a press routed wrongly would have a part to act on",
  );
  assertEqual(
    partById(posed, arm)?.length,
    2,
    "the arm's length before the press, which the press must leave alone",
  );
  assertEqual(
    cellAt(posed, arm, 0),
    "grab",
    "and the cursor's cell holds grab, a name this press must replace",
  );

  await pressAction(h, "ins-retract");
  await captureStill(h, "tape");
  const pressed = await h.snapshot();

  assertNotNull(
    partById(pressed, arm),
    "the arm is still on the field after the press",
  );
  assertEqual(
    cellAt(pressed, arm, 0),
    "retract",
    "under tape focus KeyS is ins-retract, so it writes retract at the cursor",
  );
  assertEqual(
    partById(pressed, arm)?.length,
    2,
    "and leaves the arm's length exactly as it stands",
  );
});
