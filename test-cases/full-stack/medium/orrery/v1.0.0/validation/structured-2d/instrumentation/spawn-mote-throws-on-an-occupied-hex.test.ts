// instrumentation/spawn-mote-throws-on-an-occupied-hex — a hex already holding a
// mote refuses another.
//
// THE RULE. "`spawnMote(q, r, type)` | ... A hex already holding a mote throws."
// (`specs/instrumentation.md`, The run), which is the surface's side of the
// field's own rule: "At rest a mote sits exactly on a hex center, and at most one
// mote occupies a hex" (`specs/field.md`). A fixture is one of those motes: "A
// fixture is one of the six motes a zodiac wheel carries" (`specs/field.md`), and
// the snapshot reports them among `sim.motes`. And "An argument outside the
// domain its operation states is invalid, and the call fails loudly rather than
// guessing what was meant" (`specs/instrumentation.md`).
//
// THE WORLD IS POSED, NOT SEARCHED. A bare run with an empty field, then a wheel
// placed while the run is live — "a part one of them adds enters the run at its
// rest pose holding nothing, with a wheel's six fixtures on its spoke hexes"
// (`specs/instrumentation.md`) — and one loose `dust` spawned south of it. So the
// field holds seven motes, six of them fixtures, and every hex the check aims at
// is occupied by exactly one of them.
//
// THE VERDICT. Both calls throw an `Error` — one on the loose mote's hex, one on
// a fixture's — and the field still holds seven motes, the loose one still the
// `dust` this check spawned and the fixture's hex still its wheel's. Nothing was
// added, so no hex carries two motes.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertTrue,
} from "../assert";
import { at } from "../field";
import { BARE, ORIGIN, SOUTH } from "../fixtures";
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

/** The wheel's spoke `0` hex, which its ring stands on. */
const FIXTURE_HEX = at(1, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("throws on a hex a mote rests on, a fixture included, and adds nothing", async () => {
  await openBareRun(h, { challenge: BARE });
  const wheel = await placePart(h, "wheel", ORIGIN, 0);
  await spawnMote(h, SOUTH, "dust");
  const before = await h.snapshot();

  const onMote = await refusalOf(() =>
    h.debug.spawnMote(SOUTH.q, SOUTH.r, "nova"),
  );
  const onFixture = await refusalOf(() =>
    h.debug.spawnMote(FIXTURE_HEX.q, FIXTURE_HEX.r, "nova"),
  );
  const after = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "refused");

  assertNotNull(before.sim, "the run is live before the refused calls");
  assertLength(
    fixturesOf(before, wheel),
    6,
    "the wheel raised its ring, so the second call really aims at a fixture's hex",
  );
  assertLength(
    before.sim?.motes ?? [],
    7,
    "six fixtures and one loose mote stand on the field before the refused calls",
  );
  assertTrue(
    onMote instanceof Error,
    "spawnMote on a hex holding a mote throws an Error",
  );
  assertTrue(
    onFixture instanceof Error,
    "spawnMote on a hex holding a fixture throws an Error",
  );
  assertLength(
    after.sim?.motes ?? [],
    7,
    "neither refused call added a mote, so no hex carries two",
  );
  assertEqual(
    moteAt(after, SOUTH)?.type,
    "dust",
    "the hex still holds the one mote that was already resting on it",
  );
  assertEqual(
    moteAt(after, FIXTURE_HEX)?.wheel,
    wheel,
    "the fixture's hex still holds its wheel's fixture and nothing besides",
  );
});

/**
 * What `call` threw, or `null` when it returned.
 *
 * Every member of the surface answers a promise (`validation/README.md`), so a
 * refusal arrives as a rejection and is read back here rather than through
 * `assert.ts`'s synchronous {@link assertThrows}.
 */
async function refusalOf(call: () => Promise<unknown>): Promise<unknown> {
  try {
    await call();
    return null;
  } catch (error) {
    return error;
  }
}
