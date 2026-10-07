// editor/length-actions-do-nothing-on-a-wheel — `part-grow` with a wheel selected
// leaves its length exactly as it is.
//
// THE RULE. "`part-grow` and `part-shrink` change AN ARM'S LENGTH within the
// bounds `specs/parts.md` fixes" (`specs/editor.md`, Selection on the field) — an
// arm's, and a wheel is not an arm. `specs/parts.md` says why a wheel has no
// length to change: "A wheel is a hub on its anchor hex carrying six fixture
// motes, one on each adjacent hex … Its anatomy is the hub and its ring alone, so
// ITS `length` IS ALWAYS `1`, as `specs/formats.md` records."
//
// KeyW IS SHARED with `ins-extend`, so the focus is posed on the FIELD, which is
// the half of the pair the rule is about (`specs/controls.md`).
//
// THE CONFIGURATION. `BARE` opened in the editor, its machine cleared, and two
// parts: one WHEEL anchored on `(0, 0)` and one ARM anchored on `(-3, 0)`, three
// hexes clear of the wheel's ring and sharing no anchor with it.
//
// WHY THE ARM IS THERE. The verdict is that something did NOT change, which a
// build that never reads `KeyW` under field focus would satisfy for the wrong
// reason. So the arm is selected FIRST and pressed, and its length must rise from
// `ARM_MIN_LEN` to `2` — that reading is what says `part-grow` is live in this
// posed world. The wheel is then selected and pressed, and that press is the
// item's own verdict.
//
// THE VERDICT. After the press with the wheel selected, the wheel's length is
// still `1`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { ARM_MIN_LEN } from "../constants";
import { BARE, ORIGIN, WEST } from "../fixtures";
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

it("leaves a selected wheel at length 1 under part-grow", async () => {
  await openChallengeDocument(h, BARE);
  const wheel = await placePart(h, "wheel", ORIGIN);
  const arm = await placePart(h, "arm", WEST);

  await h.debug.setSelected(arm);
  await h.debug.setFocus("field");
  await pressAction(h, "part-grow");
  const armGrown = partById(await h.snapshot(), arm)?.length;
  const before = partById(await h.snapshot(), wheel);

  await h.debug.setSelected(wheel);
  await pressAction(h, "part-grow");
  await captureStill(h, "held");

  assertEqual(
    armGrown,
    ARM_MIN_LEN + 1,
    "with the arm selected the press lengthens it, so part-grow is live in this world",
  );
  assertNotNull(before, "the wheel is on the field before the press");
  assertEqual(before?.length, 1, "and a wheel's length is 1");

  const after = partById(await h.snapshot(), wheel);
  assertNotNull(after, "the wheel is still on the field after the press");
  assertEqual(
    after?.length,
    1,
    "a part-grow press with a wheel selected leaves its length at 1: the length verbs change an arm's length",
  );
});
