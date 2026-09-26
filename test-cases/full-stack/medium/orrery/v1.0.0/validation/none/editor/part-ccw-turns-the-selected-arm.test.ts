// editor/part-ccw-turns-the-selected-arm — one `part-ccw` press lowers the selected
// arm's rotation by one step, modulo six.
//
// THE RULE. "The field-focus actions of `specs/controls.md` act on the selected
// part: `part-cw` and `part-ccw` TURN AN ARM, A WHEEL, OR A SIGIL ONE ROTATION
// STEP" (`specs/editor.md`, Selection on the field). Which way, and by how much,
// is `specs/field.md`: "Rotating a direction index clockwise adds `1` modulo `6`;
// COUNTERCLOCKWISE SUBTRACTS `1`", over a part that "carries an anchor hex and a
// rotation `0` to `5`" (`specs/parts.md`). `specs/controls.md` binds the verb:
// "`part-ccw` | `KeyQ` | The same, counterclockwise."
//
// THE CONFIGURATION. `BARE` opened in the editor, its machine cleared, and ONE arm
// anchored on `(0, 0)` at rotation `0` and length `1`. The selection and the focus
// are posed through the surface — `setSelected`, which "Selects that part", and
// `setFocus`, which "Sets the focus to `field`" — so the world the press lands in
// is exactly the one the rule names and no pointer gesture is mixed into it.
// Nothing else is on the field, so nothing else can be turned instead.
//
// AN ARM'S TURN IS ALWAYS LEGAL HERE, so no press is refused by the placement
// rules: `specs/parts.md`'s rule 1 asks only that "an arm or wheel's ANCHOR" is on
// the field, and the anchor does not move under a rotation, while "a gripper and
// the drawn arm between base and gripper pass over any hex, on or off the field,
// and over any part."
//
// SIX PRESSES, NOT ONE, so the whole of "subtracts `1`" modulo six is decided: the
// first press wraps DOWNWARD from `0` to `5` rather than landing on `-1`, and the
// rotation then reads `4`, `3`, `2`, `1`, and `0`.
//
// THE VERDICT. After press `k` the arm's rotation is `(6 - k) mod 6`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
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

it("lowers the selected arm's rotation by one step per press, wrapping below zero", async () => {
  await openChallengeDocument(h, BARE);
  const arm = await placePart(h, "arm", ORIGIN);
  await h.debug.setSelected(arm);
  await h.debug.setFocus("field");

  const placed = partById(await h.snapshot(), arm);

  for (let press = 1; press <= 6; press += 1) {
    await pressAction(h, "part-ccw");
    if (press === 1) {
      await captureStill(h, "turned");
      assertNotNull(placed, "the arm is on the field before the first press");
      assertEqual(placed?.rotation, 0, "and it stands at rotation 0");
    }

    const turned = partById(await h.snapshot(), arm);
    assertNotNull(turned, `the arm is still on the field after press ${press}`);
    assertEqual(
      turned?.rotation,
      (6 - press) % 6,
      `press ${press} of part-ccw leaves the arm at rotation ${(6 - press) % 6}: one counterclockwise step subtracts 1 modulo 6`,
    );
  }
});
