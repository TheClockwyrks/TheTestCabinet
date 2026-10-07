// editor/press-off-every-hex-clears-the-selection — a field press that targets no
// hex at all clears the selection.
//
// THE RULE. "The press selects that part; a press on a bare hex, or off every
// part, clears the selection" (`specs/editor.md`, Selection on the field), where
// what a press lands on is `specs/field.md`'s targeting rule: "The pointer targets
// the field hex whose center is nearest to the pointer position, provided that
// distance is at most `HEX_HIT_R` (`26`)." A point farther than that from every
// center targets no hex, so it is off every part, and the selection goes.
//
// WHERE SUCH A POINT IS, and why it is inside the field. The hexes are `HEX_PITCH`
// (`48`) apart, so the point equidistant from three mutually adjacent centers — the
// corner the three hexes meet at — stands `HEX_PITCH / sqrt(3)`, about `27.71`,
// from each of them. That is farther than `HEX_HIT_R` (`26`) and it is the
// FARTHEST any point of the field's interior gets from a center, which is why the
// rule leaves a gap at all. The corner used below is the one where `(0, 0)`,
// `(1, 0)` and `(0, 1)` meet, and the check reads its own oracle first: the point
// lies inside the field's region — "`x` `TRAY_REGION_W` (`224`) to `READOUT_X0`
// (`1008`), `y` `HEADING_H` (`48`) to `TAPE_Y0` (`560`)" — and no field hex center
// is within `HEX_HIT_R` of it.
//
// THE CONFIGURATION. `BARE` opened in the editor with ONE arm at `(-3, 0)`,
// selected through the surface, and nothing else on the field. The arm sits three
// hexes from the corner pressed, so the press is off every part by distance as
// well as by the targeting rule.
//
// THE VERDICT. `editor.selected` is `null` after the press, and no drag began.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertNull,
  assertTrue,
} from "../assert";
import { HEX_HIT_R } from "../constants";
import {
  at,
  contains,
  distance,
  FIELD_REGION,
  fieldHexes,
  hexCenter,
  targetHex,
  type StagePoint,
} from "../field";
import { BARE, WEST } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  placePart,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

/** The corner where the hexes `(0, 0)`, `(1, 0)` and `(0, 1)` meet. */
const CORNER: StagePoint = (() => {
  const centers = [at(0, 0), at(1, 0), at(0, 1)].map(hexCenter);
  return {
    x: centers.reduce((sum, point) => sum + point.x, 0) / centers.length,
    y: centers.reduce((sum, point) => sum + point.y, 0) / centers.length,
  };
})();

/** How far the nearest field hex center stands from that corner. */
const NEAREST = Math.min(
  ...fieldHexes().map((hex) => distance(CORNER, hexCenter(hex))),
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("clears the selection when the press targets no hex", async () => {
  assertTrue(
    contains(FIELD_REGION, CORNER),
    `the corner (${CORNER.x.toFixed(2)}, ${CORNER.y.toFixed(2)}) is inside the field's region, so the press is a field press`,
  );
  assertGreaterThan(
    NEAREST,
    HEX_HIT_R,
    "no field hex center is within HEX_HIT_R of that corner, so the press targets no hex",
  );
  assertNull(
    targetHex(CORNER.x, CORNER.y),
    "the targeting rule of specs/field.md answers no hex there",
  );

  await openChallengeDocument(h, BARE);
  const arm = await placePart(h, "arm", WEST);
  await h.debug.setSelected(arm);
  assertEqual(
    (await h.snapshot()).editor.selected,
    arm,
    "the arm is selected before the press",
  );

  await pressAt(h, CORNER);
  await h.advance(1);
  await captureStill(h, "cleared");
  const editor = (await h.snapshot()).editor;
  await releasePointer(h);

  assertNull(
    editor.selected,
    "a press between the hexes targets no hex, so it is off every part and clears the selection",
  );
  assertNull(editor.drag, "and it begins no drag: it landed on no part");
});
