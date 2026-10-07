// instrumentation/link-motes-throws-on-non-adjacent-hexes — two motes that are
// not neighbors cannot be joined.
//
// THE RULE. "`linkMotes(a, b, weight)` | ... Motes on hexes that are not
// adjacent, a fixture at either end, and a pair a filament already joins each
// throw." (`specs/instrumentation.md`, The run), which is the surface's side of
// what a filament is: "A filament is a rigid link between two motes on ADJACENT
// hexes" (`specs/field.md`). Adjacency is fixed there too: "Two hexes are
// adjacent when their difference is one of `DIRS`", the six neighbor offsets.
//
// THE WORLD IS POSED, NOT SEARCHED. A bare run with an empty machine and an empty
// field, and two motes spawned back on `(0, 0)` and `(2, 0)`. Their difference is
// `(2, 0)`, which is no member of `DIRS`, so they are two hexes apart with the
// bare `(1, 0)` between them. Nothing else is on the field, so no sigil can bind
// anything and every filament the run could report would be this call's.
//
// THE VERDICT. The call throws an `Error` — "the call fails loudly rather than
// guessing what was meant" (`specs/instrumentation.md`) — and `sim.filaments` is
// still empty, so nothing was added on the way out. Both motes are still there,
// each a constellation of one.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertLength,
  assertNotNull,
  assertTrue,
} from "../assert";
import { at } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  constellationOf,
  createHarness,
  openBareRun,
  spawnMote,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("throws on two motes whose hexes are not adjacent, and adds no filament", async () => {
  await openBareRun(h, { challenge: BARE });
  const west = await spawnMote(h, at(0, 0), "dust");
  const east = await spawnMote(h, at(2, 0), "dust");

  const refusal = await refusalOf(() => h.debug.linkMotes(west, east, 1));
  const after = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "refused");

  assertNotNull(after.sim, "the run is live at the refused call");
  assertTrue(
    refusal instanceof Error,
    "linkMotes on two motes two hexes apart throws an Error",
  );
  assertLength(
    after.sim?.filaments ?? [],
    0,
    "the refused call added no filament",
  );
  assertLength(
    after.sim?.motes ?? [],
    2,
    "both motes are still on the field, unchanged by the refusal",
  );
  assertDeepEqual(
    constellationOf(after, west),
    [west],
    "an unjoined mote is a constellation of one, so nothing was linked",
  );
});

/**
 * What `call` threw, or `null` when it returned.
 *
 * Every member of the surface answers a promise (`validation/README.md`), so a
 * refusal arrives as a rejection and is read back here rather than through
 * `assert.ts`'s synchronous throw helper.
 */
async function refusalOf(call: () => Promise<unknown>): Promise<unknown> {
  try {
    await call();
    return null;
  } catch (error) {
    return error;
  }
}
