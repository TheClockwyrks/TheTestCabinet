// editor/deleting-the-part-unspends-its-entry — an entry is spent only while its
// part is on the field, so deleting the part returns the entry to the tray.
//
// THE RULE. "A rise or set entry is spent once its part is on the field: it is
// drawn visibly distinct from an unspent entry, and a press on it does nothing
// UNTIL THE PLACED PART IS DELETED" (`specs/editor.md`, The tray). So the spending
// is a condition on the field rather than a token the tray hands out once:
// removing the part restores the entry. `specs/parts.md`'s rule 5, "Each rise and
// each set is placed at most once", agrees — with the part gone, none is placed.
//
// WHAT DELETES IT. `removePart` "removes one placed part, discarding its tape and
// its tape-panel row exactly as `part-delete` does"
// (`specs/instrumentation.md`, The machine), which is the one operation this check
// needs and nothing beyond it.
//
// THE CONFIGURATION. `BARE` opened in the editor, whose tray is `arm`, one rise
// and one set. The rise is put on the field through the surface, its entry is
// pressed once — the reading that press gives is deliberately NOT asserted, since
// whether a spent entry refuses the gesture is a different item, and a build that
// never spent the entry must fail that one and pass this one — and then the rise
// is removed and the entry pressed again.
//
// THE VERDICT. With the rise off the field, a press on its entry opens a place
// drag for that same rise: reagent `0`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { traySlot } from "../field";
import { BARE, WEST } from "../fixtures";
import {
  captureReplay,
  centerOf,
  createHarness,
  openChallengeDocument,
  partIds,
  placeRise,
  pressAt,
  releasePointer,
  type DragView,
  type Harness,
} from "../harness";

/** `BARE`'s tray: `arm`, then the one rise, then the one set. */
const RISE_SLOT = 1;

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

it("opens a place drag on the entry again once its rise is deleted", async () => {
  await openChallengeDocument(h, BARE);
  const rise = await placeRise(h, 0, WEST);

  const revived = await captureReplay(h, "revived", async () => {
    await h.advance(1);
    await pressSlot(RISE_SLOT);
    await h.advance(1);
    await h.debug.removePart(rise);
    await h.advance(1);
    const opened = await pressSlot(RISE_SLOT);
    await h.advance(1);
    return opened;
  });

  assertEqual(
    (await partIds(h)).length,
    0,
    "the rise is off the field, so nothing on it can be spending its entry",
  );
  assertNotNull(
    revived,
    `a press on entry ${RISE_SLOT} opens a drag again once the placed rise is deleted`,
  );
  assertEqual(
    revived?.kind,
    "place",
    "the drag it opens is a placement, as a tray entry's drag is",
  );
  assertEqual(
    revived?.kind === "place" ? revived.part : null,
    "rise",
    "the entry places a rise again",
  );
  assertEqual(
    revived?.kind === "place" ? revived.index : null,
    0,
    "and it is reagent 0's rise, the very one that was deleted",
  );
});
