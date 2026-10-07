// editor/tray-lists-permitted-kinds-in-parts-order — the tray's first entries are
// the permitted kinds in `PARTS` order, whatever order the challenge listed them.
//
// THE RULE. "The tray offers what the challenge permits. Its entries are, in
// order: the challenge's `permitted` part kinds, in the order of `PARTS` in
// `specs/parts.md`; then one `rise` per reagent, in reagent order; then one `set`
// per product, in product order" (`specs/editor.md`, The tray). `PARTS` is
// `specs/parts.md`'s roster, "the twenty-one part kinds in this order", and the
// same file says of it: "The tray in `specs/editor.md` lists a challenge's
// permitted parts in it." So the tray's order comes from `PARTS`, and a
// challenge's own `permitted` list is a SET of kinds rather than an ordering.
//
// HOW A TRAY IS READ. The snapshot carries no tray, so the tray is read where
// `specs/editor.md` makes it observable: "Presses are targeted by these
// rectangles: a press inside entry `k` begins placing that part", and the live
// drag is in the snapshot in its `place` shape, carrying the part kind it is
// placing. So pressing entry `k` names the kind entry `k` holds.
//
// THE CONFIGURATION. A challenge whose `permitted` is written in an order that is
// NOT `PARTS` order — `wane`, `arm`, `track`, `bind`, `piston`, whose `PARTS`
// positions run `11`, `0`, `6`, `7`, `4` — so a build that listed the entries in
// document order draws a different tray from one that sorted them. Nothing is
// placed, so no entry is spent, and each press is released before the next.
//
// THE VERDICT. Entry `k`, for `k` from `0` to one below the permitted count,
// begins placing the `k`-th permitted kind in `PARTS` order.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual, assertNotNull } from "../assert";
import { traySlot } from "../field";
import { challenge, derivedTray, loneMote } from "../formats";
import {
  captureStill,
  centerOf,
  createHarness,
  openChallengeDocument,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

/**
 * A challenge whose `permitted` is written out of `PARTS` order: `wane` (`11`),
 * `arm` (`0`), `track` (`6`), `bind` (`7`), `piston` (`4`).
 */
const OUT_OF_ORDER = challenge({
  name: "Out Of Order",
  reagents: [loneMote("dust")],
  products: [loneMote("dust")],
  permitted: ["wane", "arm", "track", "bind", "piston"],
});

/** The kinds `specs/editor.md` requires the tray's first entries to be, in order. */
const EXPECTED = derivedTray(OUT_OF_ORDER)
  .filter((entry) => entry.index === null)
  .map((entry) => entry.kind);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The kind entry `slot` begins placing, or `null` when it begins no placement. */
async function slotKind(slot: number): Promise<string | null> {
  await pressAt(h, centerOf(traySlot(slot)));
  const drag = (await h.snapshot()).editor.drag;
  await releasePointer(h);
  return drag !== null && drag.kind === "place" ? drag.part : null;
}

it("orders the permitted entries by PARTS rather than by the document", async () => {
  assertNotEqual(
    OUT_OF_ORDER.permitted.join(","),
    EXPECTED.join(","),
    "the challenge lists its permitted kinds out of PARTS order, so the two orderings are told apart",
  );

  await openChallengeDocument(h, OUT_OF_ORDER);
  await captureStill(h, "tray");

  for (const [slot, kind] of EXPECTED.entries()) {
    const found = await slotKind(slot);
    assertNotNull(found, `tray entry ${slot} begins a placement`);
    assertEqual(
      found,
      kind,
      `tray entry ${slot} places ${kind}, the ${slot}-th permitted kind in PARTS order`,
    );
  }
});
