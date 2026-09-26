// editor/part-shrink-shortens-the-selected-arm — one `part-shrink` press lowers the
// selected arm's length by one.
//
// THE RULE. "`part-grow` and `part-shrink` CHANGE AN ARM'S LENGTH within the
// bounds `specs/parts.md` fixes" (`specs/editor.md`, Selection on the field). The
// bounds are "Length is a whole number from `ARM_MIN_LEN` (`1`) to `ARM_MAX_LEN`
// (`3`), chosen in the editor" (`specs/parts.md`, Arms), and the key is
// `specs/controls.md`'s: "`part-shrink` | `KeyS` | Shortens the selected or
// dragged arm within the same bounds."
//
// KeyS IS SHARED, so the focus is load-bearing: "`part-shrink` and `ins-retract`
// on `KeyS` … the game reads the ones the current focus names"
// (`specs/controls.md`). The focus is posed on the FIELD.
//
// THE CONFIGURATION. `BARE` opened in the editor, its machine cleared, and ONE arm
// anchored on `(0, 0)`, put at `ARM_MAX_LEN` (`3`) through the surface's
// `setPartLength`, which "Sets that part's rest length" — the length the item's
// rule starts from. The selection and the focus are posed through `setSelected`
// and `setFocus`, so no pointer gesture is mixed in. Nothing else is on the field.
//
// SHRINKING IS ALWAYS LEGAL HERE, so the press is not refused by the placement
// rules: rule 1 asks only that "an arm or wheel's ANCHOR" is on the field, and a
// shorter arm moves its grippers alone, which "pass over any hex, on or off the
// field, and over any part."
//
// THE VERDICT. The arm stands at `3` before the press and at `2` after it.

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

it("lowers the selected arm's length from ARM_MAX_LEN to two", async () => {
  await openChallengeDocument(h, BARE);
  const arm = await placePart(h, "arm", ORIGIN);
  await h.debug.setPartLength(arm, ARM_MAX_LEN);
  await h.debug.setSelected(arm);
  await h.debug.setFocus("field");

  const before = partById(await h.snapshot(), arm);

  await pressAction(h, "part-shrink");
  await captureStill(h, "shrunk");

  assertNotNull(before, "the arm is on the field before the press");
  assertEqual(
    before?.length,
    ARM_MAX_LEN,
    `the arm is posed at ARM_MAX_LEN (${ARM_MAX_LEN}) before the press`,
  );

  const after = partById(await h.snapshot(), arm);
  assertNotNull(after, "the arm is still on the field after the press");
  assertEqual(
    after?.length,
    ARM_MAX_LEN - 1,
    `one part-shrink press shortens the selected arm by one, to ${ARM_MAX_LEN - 1}`,
  );
});
