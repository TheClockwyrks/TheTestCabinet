// sigils/set-tally-rises-by-one — one plain product, one tally.
//
// THE RULE. "An accepted constellation is consumed whole, and the set's tally
// rises by `1` for a plain product and by `k` for a repeating one"
// (`specs/sigils.md`, Rises and sets). A plain product is one whose molecule
// carries no `repeat`: "`repeat` appears on repeating products alone, and is
// absent otherwise" (`specs/formats.md`). Where the figure is read is fixed by
// `specs/instrumentation.md`'s snapshot shape: `sim.tallies`, "one entry per
// product", in product order.
//
// THE CONFIGURATION. A set for a one-mote plain product, alone on the field, fed
// TWICE. Twice is what makes the item's "by 1" readable rather than "to 1": a
// build that set the tally to the number of products delivered so far and one that
// simply set it to `1` are told apart by the second delivery. Nothing else is
// placed, so no rise refills the hex and no other set can raise the same entry.
//
// THE TALLY IS READ, NOT ASSUMED. `tallyOf` answers `null` when the run reports no
// entry for the product, so the figure before the first delivery is asserted to be
// there before any arithmetic is done on it — otherwise a build reporting an empty
// `tallies` would be compared against itself.
//
// THE VERDICT. The entry for this set's product is one higher after the first
// delivery than before it, and one higher again after the second.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  openBareRun,
  placeSet,
  spawnMote,
  tallyOf,
  type Harness,
} from "../harness";

/** Which of the challenge's products this set receives. */
const PRODUCT = 0;

/** How many accepted deliveries the check makes. */
const DELIVERIES = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises its product's tally by exactly 1 on each accepted plain product", async () => {
  // BARE's one product is a single `sol` on (0, 0), and it carries no repeat.
  await openBareRun(h, { challenge: BARE });
  await placeSet(h, PRODUCT, ORIGIN, 0);

  const opened = await h.snapshot();
  const before = tallyOf(opened, PRODUCT);
  assertNotNull(
    before,
    "sim.tallies carries one entry per product, so this set's entry is reported",
  );

  for (let delivery = 1; delivery <= DELIVERIES; delivery += 1) {
    await spawnMote(h, ORIGIN, "sol");

    await advanceCycles(h, 1);
    if (delivery === 1) await captureStill(h, "tally");

    const after = await h.snapshot();
    assertEqual(
      after.sim?.status,
      "running",
      "a set that consumes raises no fault, so the run is still live",
    );
    assertLength(
      after.sim?.motes ?? [],
      0,
      "the accepted product was consumed, so the field is empty again",
    );
    assertEqual(
      tallyOf(after, PRODUCT),
      (before ?? 0) + delivery,
      `delivery ${delivery} of ${DELIVERIES}: the tally is 1 higher than before it`,
    );
  }
});
