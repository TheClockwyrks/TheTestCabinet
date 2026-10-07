// editor/part-shrink-stops-at-arm-min-len — `part-shrink` leaves an arm already at
// `ARM_MIN_LEN` exactly as it stands.
//
// THE RULE. "`part-grow` and `part-shrink` change an arm's length WITHIN THE
// BOUNDS `specs/parts.md` fixes" (`specs/editor.md`, Selection on the field), and
// those bounds are "Length is a whole number from `ARM_MIN_LEN` (`1`) to
// `ARM_MAX_LEN` (`3`), chosen in the editor" (`specs/parts.md`, Arms).
// `specs/controls.md` binds the verb the same way: "`part-shrink` | `KeyS` |
// Shortens the selected or dragged arm WITHIN THE SAME BOUNDS." A length of `0`
// is outside them, so the press has nothing to do.
//
// KeyS IS SHARED with `ins-retract`, so the focus is posed on the FIELD, which is
// the half of the pair this rule is about (`specs/controls.md`).
//
// THE CONFIGURATION. `BARE` opened in the editor, its machine cleared, and ONE arm
// anchored on `(0, 0)`, put at length `2` through the surface's `setPartLength`.
// The selection and the focus are posed through `setSelected` and `setFocus`.
// Nothing else is on the field.
//
// WHY THE ARM STARTS AT TWO. The verdict here is that something did NOT change,
// which a build that never reads `KeyS` at all would satisfy for the wrong reason.
// So the FIRST press is made from `2`, where the bound allows it and the length
// must fall to `ARM_MIN_LEN`; that reading is what says the verb is live in this
// posed world. The SECOND press, from `ARM_MIN_LEN`, is the item's own verdict.
//
// THE VERDICT. The second press leaves the arm at `ARM_MIN_LEN` (`1`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { ARM_MIN_LEN } from "../constants";
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the arm at ARM_MIN_LEN under a further part-shrink press", async () => {
  await openChallengeDocument(h, BARE);
  const arm = await placePart(h, "arm", ORIGIN);
  await h.debug.setPartLength(arm, ARM_MIN_LEN + 1);
  await h.debug.setSelected(arm);
  await h.debug.setFocus("field");

  await pressAction(h, "part-shrink");
  const lowered = partById(await h.snapshot(), arm);

  await pressAction(h, "part-shrink");
  await captureStill(h, "floored");

  assertNotNull(lowered, "the arm is on the field after the first press");
  assertEqual(
    lowered?.length,
    ARM_MIN_LEN,
    `the first press shortens the arm to ARM_MIN_LEN (${ARM_MIN_LEN}), so part-shrink is live in this world`,
  );

  const floored = partById(await h.snapshot(), arm);
  assertNotNull(
    floored,
    "the arm is still on the field after the second press",
  );
  assertEqual(
    floored?.length,
    ARM_MIN_LEN,
    `a part-shrink press at ARM_MIN_LEN leaves the arm at ${ARM_MIN_LEN}: the verb changes a length within the bounds`,
  );
});
