// editor/part-grow-stops-at-arm-max-len — `part-grow` leaves an arm already at
// `ARM_MAX_LEN` exactly as it stands.
//
// THE RULE. "`part-grow` and `part-shrink` change an arm's length WITHIN THE
// BOUNDS `specs/parts.md` fixes" (`specs/editor.md`, Selection on the field), and
// those bounds are "Length is a whole number from `ARM_MIN_LEN` (`1`) to
// `ARM_MAX_LEN` (`3`), chosen in the editor" (`specs/parts.md`, Arms).
// `specs/controls.md` binds the verb the same way: "`part-grow` | `KeyW` |
// Lengthens the selected or dragged arm WITHIN THE BOUNDS `specs/parts.md`
// fixes." A length of `4` is outside them, so the press has nothing to do.
//
// KeyW IS SHARED with `ins-extend`, so the focus is posed on the FIELD, which is
// the half of the pair this rule is about (`specs/controls.md`).
//
// THE CONFIGURATION. `BARE` opened in the editor, its machine cleared, and ONE arm
// anchored on `(0, 0)`, put at length `2` through the surface's `setPartLength`.
// The selection and the focus are posed through `setSelected` and `setFocus`.
// Nothing else is on the field.
//
// WHY THE ARM STARTS AT TWO. The verdict here is that something did NOT change,
// which a build that never reads `KeyW` at all would satisfy for the wrong reason.
// So the FIRST press is made from `2`, where the bound allows it and the length
// must rise to `ARM_MAX_LEN`; that reading is what says the verb is live in this
// posed world. The SECOND press, from `ARM_MAX_LEN`, is the item's own verdict.
//
// THE VERDICT. The second press leaves the arm at `ARM_MAX_LEN` (`3`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { ARM_MAX_LEN } from "../constants";
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

it("holds the arm at ARM_MAX_LEN under a further part-grow press", async () => {
  await openChallengeDocument(h, BARE);
  const arm = await placePart(h, "arm", ORIGIN);
  await h.debug.setPartLength(arm, ARM_MAX_LEN - 1);
  await h.debug.setSelected(arm);
  await h.debug.setFocus("field");

  await pressAction(h, "part-grow");
  const raised = partById(await h.snapshot(), arm);

  await pressAction(h, "part-grow");
  await captureStill(h, "capped");

  assertNotNull(raised, "the arm is on the field after the first press");
  assertEqual(
    raised?.length,
    ARM_MAX_LEN,
    `the first press lengthens the arm to ARM_MAX_LEN (${ARM_MAX_LEN}), so part-grow is live in this world`,
  );

  const capped = partById(await h.snapshot(), arm);
  assertNotNull(capped, "the arm is still on the field after the second press");
  assertEqual(
    capped?.length,
    ARM_MAX_LEN,
    `a part-grow press at ARM_MAX_LEN leaves the arm at ${ARM_MAX_LEN}: the verb changes a length within the bounds`,
  );
});
