// editor/a-placed-set-spends-its-entry — a set entry is spent while its set is on
// the field, so pressing it begins nothing and no second copy is placed.
//
// THE RULE. "A rise or set entry is spent once its part is on the field: it is
// drawn visibly distinct from an unspent entry, and a press on it does nothing
// until the placed part is deleted. Every other entry places any number of copies"
// (`specs/editor.md`, The tray). `specs/parts.md`'s placement rule 5, "Each rise
// and each set is placed at most once", is the same bound seen from the placement
// side; this item is about the ENTRY refusing the gesture.
//
// THE CONFIGURATION. A challenge with TWO products, so its tray holds two set
// entries and only one of them is spent. The set for product `1` is put on the
// field through the surface, at a hex nothing else reaches. Three gestures follow,
// each released before the next: a press on product `1`'s entry, which is the
// spent one; a press on product `0`'s entry, which is not, so the check cannot
// pass by the tray being deaf altogether; and a whole drag from product `1`'s
// entry onto a free hex `(3, 0)`, where a set WOULD be legal, so what refuses the
// second copy is the spent entry rather than a placement rule.
//
// THE VERDICT. The press on the spent entry leaves `editor.drag` `null`; the press
// on the unspent one opens a place drag for product `0`'s set; and after the drag,
// the machine still holds exactly the one set, product `1`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { traySlot } from "../field";
import { challenge, loneMote } from "../formats";
import { EAST, WEST } from "../fixtures";
import {
  captureStill,
  centerOf,
  createHarness,
  dragFromTray,
  openChallengeDocument,
  partById,
  partIds,
  placeSet,
  pressAt,
  releasePointer,
  type DragView,
  type Harness,
} from "../harness";

/** Two products, so one set entry is spent and one is not. */
const TWO_PRODUCTS = challenge({
  name: "Two Products",
  reagents: [loneMote("dust")],
  products: [loneMote("dust"), loneMote("nova")],
  permitted: ["arm"],
});

/** The tray entries: `arm`, the one rise, then product 0's set, then product 1's. */
const UNSPENT_SLOT = 2;
const SPENT_SLOT = 3;

/** The product whose set goes onto the field. */
const PLACED_PRODUCT = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The drag a press on entry `slot` opens, or `null` when it opens none. */
async function pressSlot(slot: number): Promise<DragView | null> {
  await pressAt(h, centerOf(traySlot(slot)));
  const drag = (await h.snapshot()).editor.drag;
  await releasePointer(h);
  return drag;
}

it("refuses the gesture on the spent entry and places no second set", async () => {
  await openChallengeDocument(h, TWO_PRODUCTS);
  const set = await placeSet(h, PLACED_PRODUCT, WEST);

  const onSpent = await pressSlot(SPENT_SLOT);
  const onUnspent = await pressSlot(UNSPENT_SLOT);
  await dragFromTray(h, SPENT_SLOT, EAST);

  await h.advance(1);
  await captureStill(h, "spent");

  assertNull(
    onSpent,
    `a press on entry ${SPENT_SLOT}, whose set is on the field, begins no drag`,
  );
  assertNotNull(
    onUnspent,
    `a press on entry ${UNSPENT_SLOT}, whose set is not on the field, still opens a drag`,
  );
  assertEqual(
    onUnspent?.kind === "place" ? onUnspent.index : null,
    0,
    "the entry that is not spent opens a place drag for product 0's set",
  );

  const ids = await partIds(h);
  assertEqual(
    ids.length,
    1,
    "the drag from the spent entry onto a free hex placed nothing: the machine still holds one part",
  );
  assertEqual(ids[0], set, "and that part is the set already on the field");
  assertEqual(
    partById(await h.snapshot(), set)?.index,
    PLACED_PRODUCT,
    `the standing set is still product ${PLACED_PRODUCT}'s`,
  );
});
