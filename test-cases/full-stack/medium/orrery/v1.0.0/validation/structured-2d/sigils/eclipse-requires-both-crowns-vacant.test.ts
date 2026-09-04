// sigils/eclipse-requires-both-crowns-vacant — a mote or a fixture on EITHER
// crown blocks the eclipse.
//
// THE RULE. "When both founts hold unbonded, unheld `dust` and BOTH CROWNS ARE
// VACANT, both `dust` are consumed, an `umbra` appears on the umbral crown, and
// a `lumen` appears on the lumen crown" (`specs/sigils.md`, `eclipse`), where
// the term is defined at the top of the same page: "vacant: the hex holds
// neither a mote nor a fixture", and the one exception is fenced off — "A
// fixture satisfies one condition only, the `mirror` source below." So both
// kinds of occupant block, on either of the two crowns, and "A sigil whose
// condition does not hold at a boundary waits": neither `dust` is consumed, not
// even the one whose own crown is clear.
//
// THE CONFIGURATION, twice, on one `eclipse` anchored on the middle of the field
// at rotation `0`. Both times a `dust` rests on each fount, unbonded and unheld,
// so the founts alone would eclipse.
//
//   * First a `sol` rests on the UMBRAL crown at `(0, 1)`. A `sol` is no
//     business of any sigil on this field; what it does is occupy the hex.
//   * Then the field is emptied and a wheel's FIXTURE rests on the LUMEN crown
//     at `(1, -1)`. "A `wheel` is a hub on its anchor hex carrying six fixture
//     motes, one on each adjacent hex" (`specs/parts.md`) and a wheel placed
//     into a live run raises its ring (`specs/instrumentation.md`), so the hub
//     goes on the lumen crown's neighbor away from the sigil and the other five
//     fixtures come off with `removeMote`, the gate the specification names for
//     a wheel's fixtures. Its tape is empty, "which every part rests on".
//
// So the two scenarios differ in which crown is occupied AND in whether the
// occupant is a mote or a fixture, which are exactly the two ways the item
// states the rule.
//
// THE VERDICT, at each boundary. Neither `dust` is consumed, both are still
// `dust` on their founts, no `umbra` and no `lumen` are anywhere on the field,
// and the occupant is still the thing on its crown.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { at, place } from "../field";
import { sigilPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  fixturesOf,
  looseMotes,
  moteAt,
  openBareRun,
  placePart,
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

it("waits while either crown holds a mote or a fixture", async () => {
  const anchor = ORIGIN;
  const rotation = 0;
  const first = place(at(0, 0), anchor, rotation);
  const second = place(at(1, 0), anchor, rotation);
  const umbral = place(at(0, 1), anchor, rotation);
  const lumenal = place(at(1, -1), anchor, rotation);

  await openBareRun(h, {
    challenge: BARE,
    machine: solution([sigilPart("eclipse", anchor.q, anchor.r, rotation)]),
  });

  // Scenario one: a MOTE on the UMBRAL crown.
  const west = await spawnMote(h, first, "dust");
  const east = await spawnMote(h, second, "dust");
  const blocker = await spawnMote(h, umbral, "sol");

  const posed = await h.snapshot();
  assertEqual(
    moteAt(posed, first)?.type,
    "dust",
    "one dust is on the first fount",
  );
  assertEqual(
    moteAt(posed, second)?.type,
    "dust",
    "the other is on the second",
  );
  assertEqual(
    moteAt(posed, umbral)?.id,
    blocker,
    "a mote rests on the umbral crown, so that crown is not vacant",
  );
  assertNull(moteAt(posed, lumenal), "the lumen crown is left vacant");

  await advanceCycles(h, 1);
  await captureStill(h, "blocked-crown");

  const blocked = await h.snapshot();
  assertEqual(
    blocked.sim?.status,
    "running",
    "a waiting sigil is not a fault: the cycle reached its boundary",
  );
  assertEqual(
    blocked.sim?.cycle,
    1,
    "one whole cycle ran, so a boundary passed",
  );
  assertEqual(
    moteAt(blocked, first)?.id,
    west,
    "the first dust was not consumed",
  );
  assertEqual(moteAt(blocked, first)?.type, "dust", "and is still dust");
  assertEqual(
    moteAt(blocked, second)?.id,
    east,
    "the dust on the clear side was not consumed either",
  );
  assertEqual(moteAt(blocked, second)?.type, "dust", "and is still dust");
  assertEqual(
    moteAt(blocked, umbral)?.id,
    blocker,
    "the mote on the umbral crown is the one that was there, unreplaced",
  );
  assertNull(moteAt(blocked, lumenal), "no lumen appears on the vacant crown");
  assertEqual(
    looseMotes(blocked).length,
    3,
    "three motes went into the boundary and three came out",
  );

  // Scenario two: a FIXTURE on the LUMEN crown.
  await h.debug.clearMotes();
  const hub = at(lumenal.q + 1, lumenal.r);
  const wheel = await placePart(h, "wheel", hub, 0);
  const raised = await h.snapshot();
  for (const fixture of fixturesOf(raised, wheel)) {
    if (fixture.q !== lumenal.q || fixture.r !== lumenal.r) {
      await h.debug.removeMote(fixture.id);
    }
  }
  const near = await spawnMote(h, first, "dust");
  const far = await spawnMote(h, second, "dust");

  const ringed = await h.snapshot();
  assertNotNull(
    moteAt(ringed, lumenal),
    "the wheel put one of its six fixtures on the lumen crown",
  );
  assertEqual(
    moteAt(ringed, lumenal)?.wheel,
    wheel,
    "the thing on the lumen crown is that wheel's fixture, not a loose mote",
  );
  assertEqual(
    fixturesOf(ringed, wheel).length,
    1,
    "the rest of the ring came off, so the crown's fixture stands alone",
  );
  assertNull(moteAt(ringed, umbral), "the umbral crown is left vacant");

  await advanceCycles(h, 1);

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "the second boundary is not a fault either",
  );
  assertEqual(
    moteAt(after, first)?.id,
    near,
    "the first dust was not consumed",
  );
  assertEqual(moteAt(after, first)?.type, "dust", "and is still dust");
  assertEqual(
    moteAt(after, second)?.id,
    far,
    "the second dust was not consumed",
  );
  assertEqual(moteAt(after, second)?.type, "dust", "and is still dust");
  assertEqual(
    moteAt(after, lumenal)?.wheel,
    wheel,
    "the fixture is still the thing on the lumen crown",
  );
  assertNull(moteAt(after, umbral), "no umbra appears on the vacant crown");
  assertEqual(
    looseMotes(after).length,
    2,
    "the two dust are the whole of the loose motes: no polarity was spawned",
  );
});
