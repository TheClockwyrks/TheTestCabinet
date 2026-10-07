// editor/tray-lists-one-rise-per-reagent — one rise entry per reagent, after the
// permitted kinds and in reagent order.
//
// THE RULE. "Its entries are, in order: the challenge's `permitted` part kinds, in
// the order of `PARTS` in `specs/parts.md`; then one `rise` per reagent, in
// reagent order; then one `set` per product, in product order" (`specs/editor.md`,
// The tray). `specs/formats.md` names the same derivation from the document's
// side, and `specs/parts.md` says what such an entry places: "A `rise` delivers
// one reagent ... drawn from the challenge's reagents".
//
// HOW A RISE ENTRY IS READ. The live drag is in the snapshot in its `place` shape,
// carrying both the part kind and, for a rise or a set, the reagent or product
// index it belongs to — so pressing an entry says which rise it is, not merely
// that it is a rise. `specs/editor.md` makes that press the tray's only observable
// surface: "a press inside entry `k` begins placing that part."
//
// THE CONFIGURATION. A challenge with THREE reagents, whose molecules differ from
// one another so a build cannot collapse them, one permitted kind, and one
// product. Its tray is therefore `arm`, then reagent `0`'s rise, reagent `1`'s and
// reagent `2`'s, then the one set. Nothing is placed, so no entry is spent, and
// each press is released before the next.
//
// THE VERDICT. Entries `1`, `2` and `3` place the rises of reagents `0`, `1` and
// `2` in that order, and entry `4` — the first past them — places no rise at all,
// which is what fixes the COUNT at one per reagent.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual, assertNotNull } from "../assert";
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

/** Three reagents, one permitted kind, one product: a tray of five entries. */
const THREE_REAGENTS = challenge({
  name: "Three Reagents",
  reagents: [loneMote("dust"), loneMote("nova"), loneMote("luna")],
  products: [loneMote("dust")],
  permitted: ["arm"],
});

/** The entries before the rises: the permitted kinds, of which there is one. */
const FIRST_RISE = THREE_REAGENTS.permitted.length;

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

it("carries exactly one rise entry per reagent, in reagent order", async () => {
  await openChallengeDocument(h, THREE_REAGENTS);
  await captureStill(h, "rises");

  for (const [reagent] of THREE_REAGENTS.reagents.entries()) {
    const slot = FIRST_RISE + reagent;
    const found = await slotPlace(slot);
    assertNotNull(found, `tray entry ${slot} begins a placement`);
    assertEqual(
      found?.part,
      "rise",
      `tray entry ${slot} is a rise entry, the rises following the permitted kinds`,
    );
    assertEqual(
      found?.index,
      reagent,
      `tray entry ${slot} places the rise of reagent ${reagent}, the rises running in reagent order`,
    );
  }

  const past = FIRST_RISE + THREE_REAGENTS.reagents.length;
  const beyond = await slotPlace(past);
  assertNotEqual(
    beyond?.part ?? null,
    "rise",
    `tray entry ${past} places no rise, so the tray holds one per reagent and no more`,
  );
});
