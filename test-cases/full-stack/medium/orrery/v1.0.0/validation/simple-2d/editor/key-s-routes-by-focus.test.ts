// editor/key-s-routes-by-focus — one physical key, two registered actions, and the
// focus decides which of them the editor reads.
//
// THE RULE. "Two focus-routed actions share a physical key: `part-grow` and
// `ins-extend` on `KeyW`, and `part-shrink` and `ins-retract` on `KeyS`. Each is
// registered on its own, and the game reads the ones the current focus names"
// (`specs/controls.md`, Focus). What each of the two does is fixed by the same
// file: `part-shrink` "shortens the selected or dragged arm within the same
// bounds", and `ins-retract` writes `retract` at the cursor — which
// `specs/editor.md` completes: "The field-focus actions of `specs/controls.md`
// act on the selected part... `part-grow` and `part-shrink` change an arm's
// length", and "Each instruction action writes its instruction at the cursor".
//
// THE ITEM IS DECIDED IN BOTH DIRECTIONS AT ONCE, because routing is what it is
// about: under `field` focus the press must reach the arm and NOT the tape, and
// under `tape` focus it must reach the tape and NOT the arm. A build that
// registered one action for the key passes one half and fails the other.
//
// THE CONFIGURATION. One arm at the origin, selected, at length `2` — above
// `ARM_MIN_LEN` (`1`), so a shrink has somewhere to go — carrying two cells, with
// the cursor on column `0`. The cursor is left pointing at that cell throughout,
// so the field-focus press has a cell it could have written into if it were routed
// wrongly. `retract` is a name the tape does not carry, so a cell holding it
// afterwards was written by the press under tape focus.
//
// THE VERDICT. The first press leaves the arm at length `1` and column `0` still
// holding `grab`; the second leaves column `0` holding `retract` and the arm still
// at length `1`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { ARM_MIN_LEN } from "../constants";
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

it("shrinks the selected arm under field focus and writes retract under tape focus", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([armPart("arm", 0, 0, 0, 2, ["grab", "drop"])]),
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
    2,
    `the arm stands above ARM_MIN_LEN (${ARM_MIN_LEN}), so part-shrink has somewhere to go`,
  );
  assertEqual(
    cellAt(posed, arm, 0),
    "grab",
    "and the cursor's cell holds grab",
  );

  await pressAction(h, "part-shrink");
  await captureStill(h, "field");
  const shrunk = await h.snapshot();

  await h.debug.setFocus("tape");
  await pressAction(h, "ins-retract");
  await captureStill(h, "tape");
  const written = await h.snapshot();

  assertNotNull(
    partById(shrunk, arm),
    "the arm is still on the field after the field-focus press",
  );
  assertEqual(
    partById(shrunk, arm)?.length,
    1,
    "under field focus KeyS is part-shrink, so it shortens the selected arm",
  );
  assertEqual(
    cellAt(shrunk, arm, 0),
    "grab",
    "and leaves the cursor's cell exactly as it stands",
  );

  assertEqual(
    cellAt(written, arm, 0),
    "retract",
    "under tape focus KeyS is ins-retract, so it writes retract at the cursor",
  );
  assertEqual(
    partById(written, arm)?.length,
    1,
    "and leaves the arm's length exactly as it stands",
  );
});
