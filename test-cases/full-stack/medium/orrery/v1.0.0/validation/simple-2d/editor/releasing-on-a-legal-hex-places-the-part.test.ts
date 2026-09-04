// editor/releasing-on-a-legal-hex-places-the-part — releasing a tray drag over a
// legal hex appends one part of the dragged kind, anchored there.
//
// THE RULE. "From the tray: the ghost is a new part at the targeted hex, at
// rotation `0` and length `1`. RELEASING ON A LEGAL HEX PLACES IT and selects it;
// releasing anywhere else places nothing" (`specs/editor.md`, Dragging). Legal is
// `specs/parts.md`'s: "A placement, whether by hand in the editor or through a
// loaded solution, is legal exactly when all of the following hold", of which rule
// 1 asks that "an arm or wheel's anchor" is on the field and rule 4 that "No two
// arms or wheels share an anchor hex." Where the part lands in the machine is
// `specs/instrumentation.md`'s `editor.parts`, which is "placement order" — so a
// part placed last stands last.
//
// THE CONFIGURATION. `BARE` opened in the editor, whose one permitted kind is
// `arm`, so tray entry `0` is the arm. ONE arm is already on the field, anchored
// on `(-3, 0)`, put there through the surface so the drag below is the only
// gesture this check makes; it is what gives "appends" something to be appended
// after. The drag runs from entry `0` to `(3, 0)`, six hexes away, so the two
// anchors differ and neither arm's gripper reaches the other — a hex the placement
// rules allow.
//
// THE VERDICT. The machine holds two parts, the second of them an `arm` anchored
// on `(3, 0)`, and it is the LAST entry of `editor.parts` rather than the first.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual, assertNotNull } from "../assert";
import { BARE, EAST, WEST } from "../fixtures";
import {
  captureStill,
  createHarness,
  dragFromTray,
  openChallengeDocument,
  placePart,
  type Harness,
} from "../harness";

/** `BARE`'s tray: the one permitted kind, `arm`, then its rise and its set. */
const ARM_SLOT = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("appends one arm anchored on the hex the release landed on", async () => {
  await openChallengeDocument(h, BARE);
  const standing = await placePart(h, "arm", WEST);
  const before = (await h.snapshot()).editor.parts.length;

  await dragFromTray(h, ARM_SLOT, EAST);
  await h.advance(1);
  await captureStill(h, "placed");

  assertEqual(before, 1, "one arm stands on the field before the drag");

  const parts = (await h.snapshot()).editor.parts;
  assertEqual(
    parts.length,
    2,
    "releasing on a legal hex places the dragged part, so the machine holds one more",
  );
  assertEqual(
    parts[0]?.id,
    standing,
    "the arm that was already there still stands first in placement order",
  );

  const placed = parts[1] ?? null;
  assertNotNull(placed, "and the placed part is appended after it");
  assertNotEqual(
    placed?.id,
    standing,
    "it is a new part rather than the standing one moved",
  );
  assertEqual(placed?.kind, "arm", "of the kind the drag carried");
  assertEqual(
    `${placed?.q},${placed?.r}`,
    `${EAST.q},${EAST.r}`,
    "anchored on the hex the release landed on",
  );
});
