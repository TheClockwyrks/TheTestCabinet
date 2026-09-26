// editor/key-w-grows-the-arm-under-field-focus — one physical key, two
// registered actions, and the focus decides which of them the editor reads.
// This point reads the field-focus half.
//
// THE RULE. "Two focus-routed actions share a physical key: `part-grow` and
// `ins-extend` on `KeyW`, and `part-shrink` and `ins-retract` on `KeyS`. Each
// is registered on its own, and the game reads the ones the current focus
// names" (`specs/controls.md`, Focus). What `part-grow` does is fixed by the
// same file: `part-grow` "lengthens the selected or dragged arm within the
// bounds `specs/parts.md` fixes", which `specs/editor.md` completes: "The
// field-focus actions of `specs/controls.md` act on the selected part...
// `part-grow` and `part-shrink` change an arm's length".
//
// THE VERDICT IS ONE DIRECTION OF THE ROUTING. Under `field` focus the press
// must reach the arm and NOT the tape, and both halves of that sentence are the
// one decision this point makes: a key routed to the other action fails on the
// first, and a key wired to both fails on the second. The opposite direction is
// `key-w-writes-extend-under-tape-focus`, and neither point stands on the other
// — this one poses its own arm and reads it after its own single press.
//
// THE CONFIGURATION. One arm at the origin, selected, at length `1` — below
// `ARM_MAX_LEN` (`3`), so a grow has somewhere to go — carrying two cells, with
// the cursor on column `0`. The cursor points at that cell throughout, so the
// press has a cell it could have written into if it were routed wrongly, and
// `grab` is what that cell holds before and must still hold after.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { ARM_MAX_LEN } from "../constants";
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

it("grows the selected arm under field focus", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([armPart("arm", 0, 0, 0, 1, ["grab", "drop"])]),
  );
  const arm = (await partIds(h))[0] ?? -1;

  await h.debug.setSelected(arm);
  await h.debug.setCursor(arm, 0);
  await h.debug.setFocus("field");

  const posed = await h.snapshot();
  assertEqual(
    posed.editor.selected,
    arm,
    "the arm is selected, so the field-focus action has a part to act on",
  );
  assertEqual(
    partById(posed, arm)?.length,
    1,
    `the arm stands below ARM_MAX_LEN (${ARM_MAX_LEN}), so part-grow has somewhere to go`,
  );
  assertEqual(
    cellAt(posed, arm, 0),
    "grab",
    "and the cursor's cell holds grab",
  );

  await pressAction(h, "part-grow");
  await captureStill(h, "field");
  const pressed = await h.snapshot();

  assertNotNull(
    partById(pressed, arm),
    "the arm is still on the field after the press",
  );
  assertEqual(
    partById(pressed, arm)?.length,
    2,
    "under field focus KeyW is part-grow, so it lengthens the selected arm",
  );
  assertEqual(
    cellAt(pressed, arm, 0),
    "grab",
    "and leaves the cursor's cell exactly as it stands",
  );
});
