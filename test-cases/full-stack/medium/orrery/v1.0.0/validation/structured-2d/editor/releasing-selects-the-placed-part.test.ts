// editor/releasing-selects-the-placed-part — the release of a place drag selects
// the part it just added.
//
// THE RULE. "From the tray: the ghost is a new part at the targeted hex, at
// rotation `0` and length `1`. RELEASING ON A LEGAL HEX PLACES IT AND SELECTS IT"
// (`specs/editor.md`, Dragging). What that buys the player is stated a section
// earlier: "The field-focus actions of `specs/controls.md` act on the selected
// part" (Selection on the field), so the part the release added is under
// `part-cw`, `part-grow` and `part-delete` at once, with nothing pressed in
// between.
//
// THE CONFIGURATION. `BARE` opened in the editor, whose tray is `arm`, one rise
// and one set, on the empty machine `loadChallenge` leaves. The selection is
// cleared through the surface first, so what `editor.selected` names afterwards is
// the release's doing rather than a value the drag inherited. Then one gesture: a
// press in the middle of tray entry `0`, a move onto the centre of `ORIGIN`, and a
// release. `ORIGIN` is bare and the machine is empty, so an arm there satisfies
// every one of `specs/parts.md`'s six placement rules — the placement oracle says
// so before the gesture rather than the build being asked to agree.
//
// WHERE THE PART LANDED IS NOT THIS POINT. That the release places a part, and
// that it lands at the ghost's pose, are their own review items; this one reads
// only that the part the machine gained is the part the selection names.
//
// THE VERDICT. The machine holds exactly one part, and `editor.selected` is that
// part's id.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { armPart } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import { placementFault } from "../parts";
import {
  captureStill,
  createHarness,
  dragFromTray,
  openChallengeDocument,
  partIds,
  type Harness,
} from "../harness";

/** `BARE`'s tray: `arm`, then the one rise, then the one set. */
const ARM_SLOT = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("names the newly placed part in editor.selected", async () => {
  assertNull(
    placementFault([armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, [])], {
      reagents: BARE.reagents,
      products: BARE.products,
    }),
    "one arm alone on the origin breaks none of the six placement rules, so the release commits",
  );

  await openChallengeDocument(h, BARE);
  await h.debug.setSelected(null);
  assertNull(
    (await h.snapshot()).editor.selected,
    "nothing is selected before the drag, so the selection after it is the release's doing",
  );

  await dragFromTray(h, ARM_SLOT, ORIGIN);
  await h.advance(1);
  await captureStill(h, "selected");

  const ids = await partIds(h);
  assertEqual(
    ids.length,
    1,
    "the release on a legal hex placed the tray entry's part, and the machine holds it alone",
  );
  assertEqual(
    (await h.snapshot()).editor.selected,
    ids[0],
    "the release selects the part it placed",
  );
});
