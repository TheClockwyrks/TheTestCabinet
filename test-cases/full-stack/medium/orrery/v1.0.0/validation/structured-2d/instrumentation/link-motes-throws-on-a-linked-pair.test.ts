// instrumentation/link-motes-throws-on-a-linked-pair — at most one filament joins
// a given pair.
//
// THE RULE. "`linkMotes(a, b, weight)` | ... Motes on hexes that are not
// adjacent, a fixture at either end, and A PAIR A FILAMENT ALREADY JOINS each
// throw." (`specs/instrumentation.md`, The run), which is the surface's side of
// "At most one filament joins a given pair of motes" (`specs/field.md`).
//
// THE WORLD IS POSED, NOT SEARCHED. A bare run with an empty machine and an empty
// field, and two `nova` spawned back on the adjacent hexes `(0, 0)` and `(1, 0)`,
// joined once with a plain filament. Nothing else is on the field, so no sigil
// can bind the pair a second time and the only filament there can be is the one
// this check made. `nova` because a second attempt at weight `3` is the strongest
// case: a triune filament between two `nova` is a filament the game itself makes,
// and it must still not be laid over one that is already there.
//
// THE VERDICT. A second call on the same pair throws, at either weight and in
// either order, and the one filament stands exactly as it was: one entry, still
// of weight `1`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertTrue,
} from "../assert";
import { at } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  filamentBetween,
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

it("throws on a pair a filament already joins, and leaves that filament as it stands", async () => {
  await openBareRun(h, { challenge: BARE });
  const first = await spawnMote(h, at(0, 0), "nova");
  const second = await spawnMote(h, at(1, 0), "nova");
  await h.debug.linkMotes(first, second, 1);
  const before = await h.snapshot();

  const again = await refusalOf(() => h.debug.linkMotes(first, second, 3));
  const reversed = await refusalOf(() => h.debug.linkMotes(second, first, 1));
  const after = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "single");

  assertNotNull(before.sim, "the run is live at the refused calls");
  assertLength(
    before.sim?.filaments ?? [],
    1,
    "one filament joins the pair before the refused calls",
  );
  assertTrue(
    again instanceof Error,
    "a second linkMotes on the same pair throws an Error, whatever weight it asks for",
  );
  assertTrue(
    reversed instanceof Error,
    "the pair is the pair whichever end is named first, so the reversed call throws too",
  );
  assertLength(
    after.sim?.filaments ?? [],
    1,
    "at most one filament joins a given pair, so neither refused call added one",
  );
  assertEqual(
    filamentBetween(after, first, second)?.weight,
    1,
    "the filament that was already there stands as it stood, at the weight it was made with",
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
