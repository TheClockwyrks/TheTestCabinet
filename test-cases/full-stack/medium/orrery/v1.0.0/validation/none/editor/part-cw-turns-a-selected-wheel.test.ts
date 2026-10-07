// editor/part-cw-turns-a-selected-wheel — the rotation verbs reach a wheel, not an
// arm alone.
//
// THE RULE. "`part-cw` and `part-ccw` turn AN ARM, A WHEEL, OR A SIGIL one rotation
// step" (`specs/editor.md`, Selection on the field). A wheel carries a rotation
// like every other placed part — "Every placed arm, wheel, and sigil carries an
// anchor hex and a rotation `0` to `5`" (`specs/parts.md`) — and that rotation is
// what its ring hangs off: "The wheel's rotation turns the whole ring, so the
// fixture on spoke `d` is the entry above for `d - rotation` modulo `6`." One step
// is `specs/field.md`'s: "Rotating a direction index clockwise adds `1` modulo
// `6`."
//
// THE CONFIGURATION. `BARE` opened in the editor, its machine cleared, and ONE
// wheel anchored on `(0, 0)` at rotation `0`. The selection and the focus are
// posed through the surface — `setSelected` and `setFocus` — so the world the
// press lands in is exactly the one the rule names. Nothing else is on the field.
//
// A WHEEL'S TURN IS ALWAYS LEGAL HERE: `specs/parts.md`'s rule 1 asks only that
// "an arm or wheel's ANCHOR" is on the field, and the anchor does not move under a
// rotation. A wheel's "anatomy is the hub and its ring alone", and its ring is
// fixtures rather than footprint, so no other placement rule reads it either.
//
// SIX PRESSES, NOT ONE, so the whole of "adds `1` modulo `6`" is decided: the
// rotation reads `1`, `2`, `3`, `4`, `5`, and then `0` again rather than `6`.
//
// THE VERDICT. After press `k` the wheel's rotation is `k mod 6`.

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

it("raises the selected wheel's rotation by one step per press, wrapping at six", async () => {
  await openChallengeDocument(h, BARE);
  const wheel = await placePart(h, "wheel", ORIGIN);
  await h.debug.setSelected(wheel);
  await h.debug.setFocus("field");

  const placed = partById(await h.snapshot(), wheel);

  for (let press = 1; press <= 6; press += 1) {
    await pressAction(h, "part-cw");
    if (press === 1) {
      await captureStill(h, "turned");
      assertNotNull(placed, "the wheel is on the field before the first press");
      assertEqual(placed?.kind, "wheel", "and it is a wheel");
      assertEqual(placed?.rotation, 0, "standing at rotation 0");
    }

    const turned = partById(await h.snapshot(), wheel);
    assertNotNull(
      turned,
      `the wheel is still on the field after press ${press}`,
    );
    assertEqual(
      turned?.rotation,
      press % 6,
      `press ${press} of part-cw leaves the wheel at rotation ${press % 6}: the rotation verbs reach a wheel as they reach an arm`,
    );
  }
});
