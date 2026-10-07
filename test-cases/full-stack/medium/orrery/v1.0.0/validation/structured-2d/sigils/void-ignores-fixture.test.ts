// sigils/void-ignores-fixture — a wheel's fixture on the maw is not a mote the
// void may take.
//
// THE RULE. "An unbonded, unheld MOTE on the maw is consumed" (`specs/sigils.md`,
// The void), under a file whose terms say "A fixture satisfies one condition only,
// the `mirror` source below" — and the void's is not that condition. So a fixture
// resting on the maw is left where it is, and "A sigil whose condition does not
// hold at a boundary waits".
//
// THE CONFIGURATION. One `void` on the middle of the field and one `wheel` anchored
// one hex east of its maw. "A `wheel` is a hub on its anchor hex carrying six
// fixture motes, one on each adjacent hex" (`specs/parts.md`), so one of the six
// lands on the maw; that anchor is a rim hex, which "An arm or wheel's anchor may
// sit on any sigil footprint hex" (`specs/parts.md`) permits. The wheel's tape is
// empty, "which every part rests on" (`specs/instrumentation.md`), so the ring
// stands still and nothing carries the fixture off the maw.
//
// THE VERDICT, IN BOTH DIRECTIONS. At the boundary the fixture is still on the maw,
// still reported as that wheel's fixture, and the ring is still six. Then the ring
// is taken off the field — "`removeMote`" one per fixture, the faculty gate
// `specs/instrumentation.md` names for a wheel's fixtures — a loose `dust` is put on
// the same maw, and one further boundary runs: that one is consumed. Without the
// second reading a build with no `void` at all would pass the first.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import type { SigilName } from "../constants";
import { at, type Hex } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import { sigilRoleHex } from "../parts";
import {
  advanceCycles,
  captureStill,
  clearFixtures,
  createHarness,
  fixturesOf,
  moteAt,
  moteById,
  openBareRun,
  placePart,
  spawnMote,
  type Harness,
} from "../harness";

/** One named hex of a placed sigil, from the footprint tables of `specs/sigils.md`. */
function roleHex(
  kind: SigilName,
  role: string,
  anchor: Hex,
  rotation: number,
): Hex {
  const hex = sigilRoleHex(kind, role, anchor, rotation);
  if (hex === null) {
    throw new Error(`Orrery: specs/sigils.md gives ${kind} no ${role} hex`);
  }
  return hex;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves a wheel's fixture resting on the maw where it stands", async () => {
  await openBareRun(h, { challenge: BARE });
  await placePart(h, "void", ORIGIN, 0);
  const maw = roleHex("void", "maw", ORIGIN, 0);

  const wheel = await placePart(h, "wheel", at(maw.q + 1, maw.r), 0);
  const posed = await h.snapshot();
  const fixture = moteAt(posed, maw);
  assertNotNull(
    fixture,
    "a wheel placed into a live run puts a fixture on each of its six spoke hexes",
  );
  assertEqual(
    fixture?.wheel,
    wheel,
    "the mote on the maw is that wheel's fixture rather than a loose mote",
  );

  await advanceCycles(h, 1);
  await captureStill(h, "fixture");

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "a wheel resting on its blank tape faults at nothing",
  );
  assertEqual(
    moteAt(after, maw)?.id,
    fixture?.id,
    "a wheel's fixture resting on the maw is not consumed",
  );
  assertEqual(
    moteAt(after, maw)?.wheel,
    wheel,
    "what is still on the maw is still that wheel's fixture",
  );
  assertLength(
    fixturesOf(after, wheel),
    6,
    "the whole ring is still on the field: the void took none of the six",
  );

  // The same maw, with a loose mote on it instead of the fixture.
  await clearFixtures(h, wheel);
  assertNull(
    moteAt(await h.snapshot(), maw),
    "the ring is off the field, so the maw is bare",
  );
  const loose = await spawnMote(h, maw, "dust");
  await advanceCycles(h, 1);

  assertNull(
    moteById(await h.snapshot(), loose),
    "an unbonded, unheld mote on the same maw is consumed, so the void really acts",
  );
});
