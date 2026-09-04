// editor/a-move-translates-the-part-by-the-drag-offset — a committed move shifts
// the part by the targeted hex minus the pressed hex, not onto the pointer.
//
// THE RULE. "From the field: a press on a part selects it at once and begins a
// move. THE DRAG'S OFFSET IS THE TARGETED HEX MINUS THE PRESSED HEX, AND THE WHOLE
// PART TRANSLATES BY IT, a track's path included ... releasing elsewhere moves the
// part by the offset when the result is legal" (`specs/editor.md`, Dragging).
//
// WHY A SIGIL AND NOT AN ARM. The offset rule is only observable when the pressed
// hex is NOT the part's anchor, and an arm's every hex is its anchor. A `bind` has
// two footprint hexes, "the first" on the anchor and "the second" one step east at
// rotation `0` (`specs/sigils.md`), and "A press on the field targets a hex by the
// rule in `specs/field.md`. When parts share the hex, the topmost is taken: an arm
// or wheel anchored there, else a track with that cell, ELSE THE SIGIL WHOSE
// FOOTPRINT COVERS IT" (`specs/editor.md`, Selection on the field). So a press on
// `(1, 0)` grabs a `bind` anchored on `(0, 0)` one hex away from its anchor, which
// is exactly the case the review item names.
//
// THE CONFIGURATION. `BARE` opened in the editor with ONE `bind` anchored on
// `ORIGIN`, put there through the surface — the challenge's `permitted` list is "a
// tray rule of `specs/editor.md` rather than a placement rule"
// (`specs/instrumentation.md`), so a `bind` is as legal here as anywhere. The
// gesture presses `(1, 0)`, moves onto `(2, 0)`, and releases. The offset is one
// hex east, the result runs `(1, 0)`–`(2, 0)`, both on the field and sharing no
// footprint with anything, so the placement oracle passes it.
//
// THE VERDICT. The `bind`'s anchor is `(1, 0)` afterwards: the ORIGIN plus the
// offset, one hex east. It is not `(2, 0)`, the hex under the pointer.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { at, type Hex } from "../field";
import { sigilPart } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import { placementFault } from "../parts";
import {
  captureReplay,
  createHarness,
  dragHex,
  openChallengeDocument,
  partById,
  placePart,
  type Harness,
} from "../harness";

/** The `bind`'s second footprint hex at rotation `0`, one east of its anchor. */
const PRESSED: Hex = at(1, 0);

/** Where the pointer is released: one hex east of the hex it pressed. */
const RELEASED: Hex = at(2, 0);

/** The anchor the offset lands the part on: `ORIGIN` plus `RELEASED - PRESSED`. */
const LANDED: Hex = at(
  ORIGIN.q + RELEASED.q - PRESSED.q,
  ORIGIN.r + RELEASED.r - PRESSED.r,
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the anchor by the drag's offset rather than onto the pointer", async () => {
  assertNull(
    placementFault([sigilPart("bind", LANDED.q, LANDED.r, 0)], {
      reagents: BARE.reagents,
      products: BARE.products,
    }),
    "a lone bind anchored on (1, 0) breaks none of the six placement rules, so the move commits",
  );

  await openChallengeDocument(h, BARE);
  const bind = await placePart(h, "bind", ORIGIN);

  await captureReplay(h, "moved", async () => {
    await h.advance(1);
    await dragHex(h, PRESSED, RELEASED);
    await h.advance(1);
  });

  const moved = partById(await h.snapshot(), bind);
  assertEqual(
    `${moved?.q},${moved?.r}`,
    `${LANDED.q},${LANDED.r}`,
    "the part translated by the targeted hex minus the pressed hex, one east, rather than onto (2, 0)",
  );
});
