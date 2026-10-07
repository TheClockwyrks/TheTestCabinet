// editor/a-refused-edit-pushes-no-entry — an edit the editor refuses is not an
// edit, so nothing reaches the history.
//
// THE RULE. The history's unit is the COMMITTED edit: "Every committed edit to the
// machine pushes one entry onto the undo history", and "An edit that changes
// nothing... commits nothing and pushes no entry" (`specs/editor.md`, Undo and
// redo). What makes each of the three gestures below change nothing is stated
// where the gesture is:
//
//   - a place release on an illegal hex — "Releasing on a legal hex places it and
//     selects it; releasing anywhere else places NOTHING" (Dragging, from the
//     tray);
//   - a move release whose result would be illegal — "releasing elsewhere moves
//     the part by the offset WHEN THE RESULT IS LEGAL, and leaves it in place when
//     it is not" (Dragging, from the field);
//   - a rotation that would be illegal — "A rotation or length change that would
//     make the placement illegal under `specs/parts.md` DOES NOT HAPPEN"
//     (Selection on the field).
//
// THE CONFIGURATION, and which placement rule refuses each gesture. Two arms, at
// `(0, 0)` and at `(-3, 0)`, and one `bind` at `(-1, 5)` unrotated.
//
//   1. A drag out of the tray's arm entry, released on `(0, 0)`. Rule 4: "No two
//      arms or wheels share an anchor hex."
//   2. A drag of the arm at `(-3, 0)` onto `(0, 0)`. The same rule 4, reached by
//      the other gesture.
//   3. A `part-cw` press on the selected `bind`. Its footprint is `(0, 0)` and
//      `(1, 0)` (`specs/sigils.md`), so at `(-1, 5)` unrotated it covers `(-1, 5)`
//      and `(0, 5)`, both on a field of radius `FIELD_R` (`5`); one step clockwise
//      turns the offset `(1, 0)` into `(0, 1)` (`specs/field.md`), which lands the
//      second hex on `(-1, 6)`, off the field. Rule 1: "Every hex of the part is on
//      the field."
//
// The two hexes the rotation turns between are computed from `specs/sigils.md`'s
// footprint and `specs/field.md`'s formulas rather than written down, so the
// figure the check leans on is the specification's own.
//
// THE VERDICT. `editor.undoDepth` reads exactly what it read before all three
// gestures, and each gesture left the machine as it found it: no third part, the
// arm still on `(-3, 0)`, and the bind still unrotated.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLength,
  assertTrue,
} from "../assert";
import type { PartName } from "../constants";
import { at, onField } from "../field";
import { armPart, derivedTray, sigilPart, solution } from "../formats";
import { BARE, ORIGIN, WEST } from "../fixtures";
import { sigilHexes } from "../parts";
import {
  captureStill,
  createHarness,
  dragFromTray,
  dragHex,
  loadMachine,
  openChallengeDocument,
  partById,
  pressAction,
  solePartOfKind,
  type Harness,
} from "../harness";

/** Where the bind stands, and the rotation one `part-cw` press would give it. */
const BIND_AT = at(-1, 5);
const BIND_ROTATION = 0;
const TURNED = BIND_ROTATION + 1;

/** The tray slot a challenge offers `kind` at (`specs/editor.md`, The tray). */
function slotOf(kind: PartName): number {
  return derivedTray(BARE).findIndex((entry) => entry.kind === kind);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the undo depth as it stands after a refused place, move, and rotation", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([
      armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, []),
      armPart("arm", WEST.q, WEST.r, 0, 1, []),
      sigilPart("bind", BIND_AT.q, BIND_AT.r, BIND_ROTATION),
    ]),
  );

  const posed = await h.snapshot();
  const bind = solePartOfKind(posed, "bind")?.id ?? -1;
  const moved =
    posed.editor.parts.find(
      (part) => part.kind === "arm" && part.q === WEST.q && part.r === WEST.r,
    )?.id ?? -1;

  await dragFromTray(h, slotOf("arm"), ORIGIN);
  const placed = await h.snapshot();

  await dragHex(h, WEST, ORIGIN);
  const shifted = await h.snapshot();

  await h.debug.setFocus("field");
  await h.debug.setSelected(bind);
  await pressAction(h, "part-cw");
  const turned = await h.snapshot();

  await h.advance(1);
  await captureStill(h, "unchanged");

  assertTrue(
    sigilHexes("bind", BIND_AT, BIND_ROTATION).every(onField),
    "the bind stands legally: every hex of its footprint is on the field",
  );
  assertTrue(
    !sigilHexes("bind", BIND_AT, TURNED).every(onField),
    "one step clockwise would take a footprint hex off the field, breaking rule 1",
  );
  assertLength(
    posed.editor.parts,
    3,
    "the machine stands with the two arms and the bind the scenario placed",
  );
  assertGreaterThanOrEqual(
    slotOf("arm"),
    0,
    "the challenge's tray offers an arm entry for the first gesture to press",
  );

  assertLength(
    placed.editor.parts,
    3,
    "a release on a hex another arm is anchored on places nothing: rule 4",
  );
  assertEqual(
    placed.editor.undoDepth,
    posed.editor.undoDepth,
    "the refused placement committed nothing, so it pushed no entry",
  );

  assertEqual(
    partById(shifted, moved)?.q,
    WEST.q,
    "a move whose result would break rule 4 leaves the part in place",
  );
  assertEqual(
    partById(shifted, moved)?.r,
    WEST.r,
    "a move whose result would break rule 4 leaves the part in place",
  );
  assertEqual(
    shifted.editor.selected,
    moved,
    "the press did begin a move: either way the dragged part stays selected",
  );
  assertEqual(
    shifted.editor.undoDepth,
    posed.editor.undoDepth,
    "the refused move committed nothing, so it pushed no entry",
  );

  assertEqual(
    partById(turned, bind)?.rotation,
    BIND_ROTATION,
    "a rotation that would make the placement illegal does not happen",
  );
  assertEqual(
    turned.editor.undoDepth,
    posed.editor.undoDepth,
    "the refused rotation committed nothing, so it pushed no entry",
  );
  assertEqual(
    turned.editor.redoDepth,
    posed.editor.redoDepth,
    "and with nothing committed there is nothing on the redo side either",
  );
});
