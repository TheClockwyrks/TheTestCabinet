// editor/press-selects-the-part-on-the-hex — a press on the field selects the part
// occupying the hex it targeted.
//
// THE RULE. "A press on the field targets a hex by the rule in `specs/field.md`.
// When parts share the hex, the topmost is taken: an arm or wheel anchored there,
// else a track with that cell, else the sigil whose footprint covers it. The press
// selects that part" (`specs/editor.md`, Selection on the field). The targeting
// rule it defers to is `specs/field.md`: "The pointer targets the field hex whose
// center is nearest to the pointer position, provided that distance is at most
// `HEX_HIT_R` (`26`)", and a hex's center is `hexX(q, r) = FIELD_CX + HEX_PITCH *
// (q + r / 2)`, `hexY(q, r) = FIELD_CY + HEX_PITCH * (sqrt(3) / 2) * r`.
//
// THE CONFIGURATION. `BARE` opened in the editor with TWO arms on the field, at
// `(-3, 0)` and `(3, 0)` — far enough apart that neither arm's gripper hex reaches
// the other's, so the hex a press targets names exactly one of them. No hex is
// shared by two parts, which is the separate rule about what outranks what. The
// selection is cleared before each press, so what is read afterwards is that
// press's doing rather than a value it inherited, and each press is released on
// the hex it began on, which "commits no move".
//
// THE VERDICT. Each press leaves `editor.selected` naming the arm anchored on the
// hex it landed on.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { hexCenter, type Hex } from "../field";
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

it("selects the arm anchored on the hex the press targeted", async () => {
  await openChallengeDocument(h, BARE);
  const west = await placePart(h, "arm", WEST);
  const east = await placePart(h, "arm", EAST);

  const cases: readonly { hex: Hex; part: number }[] = [
    { hex: WEST, part: west },
    { hex: EAST, part: east },
  ];

  for (const posed of cases) {
    await h.debug.setSelected(null);
    assertNull(
      (await h.snapshot()).editor.selected,
      "nothing is selected before the press, so the selection after it is the press's doing",
    );

    await pressAt(h, hexCenter(posed.hex));
    await h.advance(1);
    await captureStill(h, "selected");
    const selected = (await h.snapshot()).editor.selected;
    await releasePointer(h);

    assertEqual(
      selected,
      posed.part,
      `a press on the center of hex (${posed.hex.q}, ${posed.hex.r}) selects the arm anchored there`,
    );
  }
});
