// editor/tray-lists-one-set-per-product — one set entry per product, after the rise
// entries and in product order.
//
// THE RULE. "Its entries are, in order: the challenge's `permitted` part kinds, in
// the order of `PARTS` in `specs/parts.md`; then one `rise` per reagent, in
// reagent order; then one `set` per product, in product order"
// (`specs/editor.md`, The tray). `specs/parts.md` says what such an entry places:
// "a `set` receives one product ... drawn from the challenge's reagents and
// products as `specs/formats.md` defines them."
//
// HOW A SET ENTRY IS READ. The live drag is in the snapshot in its `place` shape,
// carrying both the part kind and, for a rise or a set, the reagent or product
// index it belongs to — so pressing an entry says WHICH set it is. That press is
// the tray's only observable surface: "a press inside entry `k` begins placing
// that part."
//
// THE CONFIGURATION. A challenge with TWO products, whose molecules differ from
// one another, one permitted kind and one reagent. Its tray is therefore `arm`,
// then the one rise, then product `0`'s set and product `1`'s. Nothing is placed,
// so no entry is spent, and each press is released before the next.
//
// THE VERDICT. Entries `2` and `3` place the sets of products `0` and `1` in that
// order, and entry `4` — the first past the last set — begins no placement at all,
// which fixes both the count and the tray's end.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { traySlot } from "../field";
import { challenge, loneMote } from "../formats";
import {
  captureStill,
  centerOf,
  createHarness,
  openChallengeDocument,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

/** Two products, one permitted kind, one reagent: a tray of four entries. */
const TWO_PRODUCTS = challenge({
  name: "Two Products",
  reagents: [loneMote("dust")],
  products: [loneMote("dust"), loneMote("nova")],
  permitted: ["arm"],
});

/** The entries before the sets: the permitted kinds, then one rise per reagent. */
const FIRST_SET = TWO_PRODUCTS.permitted.length + TWO_PRODUCTS.reagents.length;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** What entry `slot` begins placing, or `null` when it begins no placement. */
async function slotPlace(
  slot: number,
): Promise<{ part: string; index: number | null } | null> {
  await pressAt(h, centerOf(traySlot(slot)));
  const drag = (await h.snapshot()).editor.drag;
  await releasePointer(h);
  return drag !== null && drag.kind === "place"
    ? { part: drag.part, index: drag.index }
    : null;
}

it("carries exactly one set entry per product, in product order", async () => {
  await openChallengeDocument(h, TWO_PRODUCTS);
  await captureStill(h, "sets");

  for (const [product] of TWO_PRODUCTS.products.entries()) {
    const slot = FIRST_SET + product;
    const found = await slotPlace(slot);
    assertNotNull(found, `tray entry ${slot} begins a placement`);
    assertEqual(
      found?.part,
      "set",
      `tray entry ${slot} is a set entry, the sets following the rise entries`,
    );
    assertEqual(
      found?.index,
      product,
      `tray entry ${slot} places the set of product ${product}, the sets running in product order`,
    );
  }

  const past = FIRST_SET + TWO_PRODUCTS.products.length;
  assertNull(
    await slotPlace(past),
    `tray entry ${past} begins no placement, so the tray holds one set per product and ends there`,
  );
});
