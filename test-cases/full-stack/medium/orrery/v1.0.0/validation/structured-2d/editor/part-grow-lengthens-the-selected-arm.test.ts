// editor/part-grow-lengthens-the-selected-arm — one `part-grow` press raises the
// selected arm's length by one.
//
// THE RULE. "`part-grow` and `part-shrink` CHANGE AN ARM'S LENGTH within the
// bounds `specs/parts.md` fixes" (`specs/editor.md`, Selection on the field). The
// bounds are "Length is a whole number from `ARM_MIN_LEN` (`1`) to `ARM_MAX_LEN`
// (`3`), chosen in the editor" (`specs/parts.md`, Arms), and the key is
// `specs/controls.md`'s: "`part-grow` | `KeyW` | Lengthens the selected or dragged
// arm within the bounds `specs/parts.md` fixes." What the length means is the same
// section of `specs/parts.md`: "one gripper per spoke at `base + length *
// DIRS[d]`".
//
// KeyW IS SHARED, so the focus is load-bearing: "`part-grow` and `ins-extend` on
// `KeyW` … Each is registered on its own, and the game reads the ones the current
// focus names" (`specs/controls.md`). The focus is posed on the FIELD, which is
// the half of the pair this rule is about.
//
// THE CONFIGURATION. `BARE` opened in the editor, its machine cleared, and ONE arm
// anchored on `(0, 0)`, which `specs/instrumentation.md` places "at length
// `ARM_MIN_LEN` (`1`)" — the length the item's rule starts from. The selection and
// the focus are posed through the surface, `setSelected` and `setFocus`, so no
// pointer gesture is mixed in. Nothing else is on the field.
//
// GROWING IS ALWAYS LEGAL HERE, so the press is not refused by the placement
// rules: rule 1 asks only that "an arm or wheel's ANCHOR" is on the field, and a
// longer arm moves its grippers alone, which "pass over any hex, on or off the
// field, and over any part."
//
// THE VERDICT. The arm stands at `1` before the press and at `2` after it.

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

it("raises the selected arm's length from ARM_MIN_LEN to two", async () => {
  await openChallengeDocument(h, BARE);
  const arm = await placePart(h, "arm", ORIGIN);
  await h.debug.setSelected(arm);
  await h.debug.setFocus("field");

  const before = partById(await h.snapshot(), arm);

  await pressAction(h, "part-grow");
  await captureStill(h, "grown");

  assertNotNull(before, "the arm is on the field before the press");
  assertEqual(
    before?.length,
    ARM_MIN_LEN,
    `a freshly placed arm stands at ARM_MIN_LEN (${ARM_MIN_LEN})`,
  );

  const after = partById(await h.snapshot(), arm);
  assertNotNull(after, "the arm is still on the field after the press");
  assertEqual(
    after?.length,
    ARM_MIN_LEN + 1,
    `one part-grow press lengthens the selected arm by one, to ${ARM_MIN_LEN + 1}`,
  );
});
