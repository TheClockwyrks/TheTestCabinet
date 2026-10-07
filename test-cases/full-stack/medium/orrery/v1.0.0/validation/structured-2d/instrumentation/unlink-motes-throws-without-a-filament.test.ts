// instrumentation/unlink-motes-throws-without-a-filament — a pair no filament
// joins refuses to be unlinked.
//
// THE RULE. "`unlinkMotes(a, b)` | Removes the filament joining `a` and `b`. A
// pair no filament joins throws." (`specs/instrumentation.md`, The run), and "An
// argument outside the domain its operation states is invalid, and the call fails
// loudly rather than guessing what was meant".
//
// THE WORLD IS POSED, NOT SEARCHED. A bare run with an empty machine and an empty
// field, and three `dust` spawned back on `(0, 0)`, `(1, 0)` and `(0, -1)`. One
// filament joins the first pair; the second pair is ADJACENT AND UNJOINED, which
// is the strongest case there is — a build that answered the question "are these
// two next to each other?" instead of "does a filament join them?" would let it
// through. Nothing else is on the field, so no sigil can make or remove a
// filament under the reading.
//
// THE VERDICT. Both calls throw an `Error` — the adjacent unjoined pair and the
// pair that is neither joined nor adjacent — and the one filament that was there
// is still there afterwards: "removes nothing".

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertNotNull, assertTrue } from "../assert";
import { adjacent, at } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  filamentBetween,
  openBareRun,
  spawnMote,
  type Harness,
} from "../harness";

const JOINED_HEX = at(0, 0);
const OTHER_HEX = at(1, 0);
const BARE_HEX = at(0, -1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("throws on a pair no filament joins, and removes nothing", async () => {
  await openBareRun(h, { challenge: BARE });
  const joined = await spawnMote(h, JOINED_HEX, "dust");
  const other = await spawnMote(h, OTHER_HEX, "dust");
  const loose = await spawnMote(h, BARE_HEX, "dust");
  await h.debug.linkMotes(joined, other, 1);
  const before = await h.snapshot();

  const neighbors = await refusalOf(() => h.debug.unlinkMotes(joined, loose));
  const strangers = await refusalOf(() => h.debug.unlinkMotes(other, loose));
  const after = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "refused");

  assertNotNull(before.sim, "the run is live at the refused calls");
  assertLength(
    before.sim?.filaments ?? [],
    1,
    "one filament stands on the field, and it joins neither pair the calls name",
  );
  assertTrue(
    adjacent(JOINED_HEX, BARE_HEX),
    "the first pair is adjacent and unjoined, so the refusal is the filament rule and not the adjacency rule",
  );
  assertTrue(
    neighbors instanceof Error,
    "unlinkMotes on an adjacent pair no filament joins throws an Error",
  );
  assertTrue(
    strangers instanceof Error,
    "unlinkMotes on a pair that is neither joined nor adjacent throws an Error",
  );
  assertLength(
    after.sim?.filaments ?? [],
    1,
    "neither refused call removed anything",
  );
  assertNotNull(
    filamentBetween(after, joined, other),
    "the filament that was there is the filament that is still there",
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
