// instrumentation/link-motes-throws-on-a-fixture — a wheel's fixture carries no
// filament, at either end.
//
// THE RULE. "`linkMotes(a, b, weight)` | ... Motes on hexes that are not
// adjacent, A FIXTURE AT EITHER END, and a pair a filament already joins each
// throw." (`specs/instrumentation.md`, The run). A fixture is one of the six
// motes a wheel carries: "A `wheel` is a hub on its anchor hex carrying six
// fixture motes, one on each adjacent hex" (`specs/parts.md`), and the snapshot
// names the wheel each belongs to in its `wheel` field (`specs/state.md`).
//
// THE WORLD IS POSED, NOT SEARCHED. A bare run with an empty field, then a wheel
// placed while the run is live, which raises its six fixtures — "a part one of
// them adds enters the run at its rest pose holding nothing, with a wheel's six
// fixtures on its spoke hexes" (`specs/instrumentation.md`). One loose `dust` is
// spawned on `(2, 0)`, whose difference from the fixture on `(1, 0)` is `(-1, 0)`
// — a member of `DIRS`, so the two hexes ARE adjacent and the refusal cannot be
// the adjacency rule wearing a disguise.
//
// THE VERDICT. Naming the fixture second throws, naming it first throws, and
// `sim.filaments` is empty after both: the end it stands at makes no difference.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertTrue,
} from "../assert";
import { adjacent, at } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  fixturesOf,
  moteAt,
  openBareRun,
  placePart,
  spawnMote,
  type Harness,
} from "../harness";

/** The wheel's spoke `0` hex, and the loose mote's hex next to it. */
const FIXTURE_HEX = at(1, 0);
const LOOSE_HEX = at(2, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("throws with a fixture at either end, and adds no filament", async () => {
  await openBareRun(h, { challenge: BARE });
  const wheel = await placePart(h, "wheel", ORIGIN, 0);
  const loose = await spawnMote(h, LOOSE_HEX, "dust");
  const before = await h.snapshot();
  const fixture = moteAt(before, FIXTURE_HEX)?.id ?? -1;

  const second = await refusalOf(() => h.debug.linkMotes(loose, fixture, 1));
  const first = await refusalOf(() => h.debug.linkMotes(fixture, loose, 1));
  const after = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "refused");

  assertNotNull(before.sim, "the run is live at the refused calls");
  assertLength(
    fixturesOf(before, wheel),
    6,
    "the wheel raised its ring, so the hex the calls name really carries a fixture",
  );
  assertEqual(
    moteAt(before, FIXTURE_HEX)?.wheel,
    wheel,
    "the mote on that hex is the wheel's fixture rather than a loose mote",
  );
  assertTrue(
    adjacent(FIXTURE_HEX, LOOSE_HEX),
    "the two hexes are adjacent, so the refusal is the fixture rule and not the adjacency rule",
  );
  assertTrue(
    second instanceof Error,
    "linkMotes with the fixture as its second end throws an Error",
  );
  assertTrue(
    first instanceof Error,
    "linkMotes with the fixture as its first end throws an Error",
  );
  assertLength(
    after.sim?.filaments ?? [],
    0,
    "neither refused call added a filament",
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
