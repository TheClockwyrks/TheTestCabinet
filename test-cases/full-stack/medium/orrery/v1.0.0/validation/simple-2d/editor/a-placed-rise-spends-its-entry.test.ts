// editor/a-placed-rise-spends-its-entry — a rise entry is spent while its rise is
// on the field, so pressing it begins nothing and no second copy is placed.
//
// THE RULE. "A rise or set entry is spent once its part is on the field: it is
// drawn visibly distinct from an unspent entry, and a press on it does nothing
// until the placed part is deleted. Every other entry places any number of copies"
// (`specs/editor.md`, The tray). `specs/parts.md` states the same bound from the
// placement side — rule 5, "Each rise and each set is placed at most once" — and
// the two are separate requirements: this one is about the ENTRY refusing the
// gesture, not about the placement rules refusing the result.
//
// THE CONFIGURATION. A challenge with TWO reagents, so its tray holds two rise
// entries and only one of them is spent. The rise for reagent `1` is put on the
// field through the surface, at a hex nothing else reaches. Three gestures follow,
// each released before the next: a press on reagent `1`'s entry, which is the
// spent one; a press on reagent `0`'s entry, which is not, so the check cannot
// pass by the tray being deaf altogether; and a whole drag from reagent `1`'s
// entry onto a free hex `(3, 0)` — a hex where a rise WOULD be legal — so what
// refuses the second copy is the spent entry rather than a placement rule.
//
// THE VERDICT. The press on the spent entry leaves `editor.drag` `null`; the press
// on the unspent one opens a place drag for reagent `0`'s rise; and after the
// drag, the machine still holds exactly the one rise, reagent `1`'s.

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
  placeRise,
  pressAt,
  releasePointer,
  type DragView,
  type Harness,
} from "../harness";

/** Two reagents, so one rise entry is spent and one is not. */
const TWO_REAGENTS = challenge({
  name: "Two Reagents",
  reagents: [loneMote("dust"), loneMote("nova")],
  products: [loneMote("dust")],
  permitted: ["arm"],
});

/** The tray entries: `arm`, then reagent 0's rise, then reagent 1's, then the set. */
const UNSPENT_SLOT = 1;
const SPENT_SLOT = 2;

/** The reagent whose rise goes onto the field. */
const PLACED_REAGENT = 1;

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

it("refuses the gesture on the spent entry and places no second rise", async () => {
  await openChallengeDocument(h, TWO_REAGENTS);
  const rise = await placeRise(h, PLACED_REAGENT, WEST);

  const onSpent = await pressSlot(SPENT_SLOT);
  const onUnspent = await pressSlot(UNSPENT_SLOT);
  await dragFromTray(h, SPENT_SLOT, EAST);

  await h.advance(1);
  await captureStill(h, "spent");

  assertNull(
    onSpent,
    `a press on entry ${SPENT_SLOT}, whose rise is on the field, begins no drag`,
  );
  assertNotNull(
    onUnspent,
    `a press on entry ${UNSPENT_SLOT}, whose rise is not on the field, still opens a drag`,
  );
  assertEqual(
    onUnspent?.kind === "place" ? onUnspent.index : null,
    0,
    "the entry that is not spent opens a place drag for reagent 0's rise",
  );

  const ids = await partIds(h);
  assertEqual(
    ids.length,
    1,
    "the drag from the spent entry onto a free hex placed nothing: the machine still holds one part",
  );
  assertEqual(ids[0], rise, "and that part is the rise already on the field");
  assertEqual(
    partById(await h.snapshot(), rise)?.index,
    PLACED_REAGENT,
    `the standing rise is still reagent ${PLACED_REAGENT}'s`,
  );
});
