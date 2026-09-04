// editor/press-on-a-bare-hex-clears-the-selection — a press on a field hex holding
// no part clears the selection.
//
// THE RULE. "The press selects that part; a press on a bare hex, or off every
// part, clears the selection. At most one part is selected"
// (`specs/editor.md`, Selection on the field). The hex a press lands on is decided
// by `specs/field.md`'s targeting rule, and the hex used below is one whose center
// the press sits exactly on, so which hex was targeted is not in question.
//
// THE CONFIGURATION. `BARE` opened in the editor with ONE arm on the field at
// `(-3, 0)` and that arm selected through the surface. The press lands on the
// center of `(3, 0)`, six hexes east of it: no part is anchored there, no track
// cell and no sigil footprint reaches it, and the arm's own gripper at `(-2, 0)`
// is nowhere near — and a gripper is not a part on a hex in any case. Nothing else
// is on the field.
//
// THE VERDICT. `editor.selected` is `null` after the press, and no drag began,
// because there was no part on the hex to begin a move on.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { hexCenter, sameHex } from "../field";
import { BARE, EAST, WEST } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  placePart,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("clears the selection when the press lands on a hex holding no part", async () => {
  await openChallengeDocument(h, BARE);
  const arm = await placePart(h, "arm", WEST);
  await h.debug.setSelected(arm);

  const posed = (await h.snapshot()).editor;
  assertEqual(posed.selected, arm, "the arm is selected before the press");
  assertEqual(
    posed.parts.filter((part) => sameHex(part, EAST)).length,
    0,
    `no part is anchored on (${EAST.q}, ${EAST.r}), so the press lands on a bare hex`,
  );

  await pressAt(h, hexCenter(EAST));
  await h.advance(1);
  await captureStill(h, "cleared");
  const editor = (await h.snapshot()).editor;
  await releasePointer(h);

  assertNull(
    editor.selected,
    `a press on the center of the bare hex (${EAST.q}, ${EAST.r}) clears the selection`,
  );
  assertNull(
    editor.drag,
    "and it begins no drag: there is no part on that hex to move",
  );
});
