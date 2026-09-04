// sigils/conjoin-fixture-blocks-crown — a wheel's fixture on the crown makes the
// crown not vacant.
//
// THE RULE. `conjoin` requires that "the crown is vacant" (`specs/sigils.md`),
// and the term is defined a few lines above the sigils themselves: "vacant: the
// hex holds neither a mote nor a fixture." The same page fences off the one
// exception, so there is no doubt this is not it: "A fixture satisfies one
// condition only, the `mirror` source below." A fixture on a `conjoin`'s crown
// is therefore a blockage, and "A sigil whose condition does not hold at a
// boundary waits."
//
// THE CONFIGURATION. One `conjoin` anchored on the middle of the field at
// rotation `0`, with a `mars` on each fount — the same planet below `sol`,
// unbonded and unheld — so the founts alone would fuse.
//
// The blockage is a FIXTURE rather than a mote. "A `wheel` is a hub on its
// anchor hex carrying six fixture motes, one on each adjacent hex"
// (`specs/parts.md`), and a wheel placed into a LIVE run raises its ring: "While
// a run is live, a part one of them adds enters the run at its rest pose holding
// nothing, with a wheel's six fixtures on its spoke hexes"
// (`specs/instrumentation.md`). So the wheel is anchored on the crown's neighbor
// away from the sigil, and one of its six fixtures lands on the crown. The other
// five are taken off with `removeMote`, the gate `specs/instrumentation.md`
// names for a wheel's fixtures — "`removeMote` on each fixture the scenario
// leaves out" — so the fixture on the crown is the only one on the field. The
// wheel's tape is empty, "which every part rests on", so nothing turns.
//
// THE VERDICT, read at the boundary of one cycle. Both `mars` are still on their
// founts and still `mars`, the fixture is still the thing on the crown, and no
// loose mote was created — so the fixture blocked the fusion exactly as a mote
// would.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
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

it("waits while a fixture rests on the crown", async () => {
  const anchor = ORIGIN;
  const rotation = 0;
  const first = place(at(0, 0), anchor, rotation);
  const second = place(at(1, 0), anchor, rotation);
  const crown = place(at(0, 1), anchor, rotation);
  // The crown's neighbor on the far side from the sigil: a hub there rings the
  // crown without any of its six spoke hexes reaching a fount.
  const hub = at(crown.q, crown.r + 1);

  await openBareRun(h, {
    challenge: BARE,
    machine: solution([sigilPart("conjoin", anchor.q, anchor.r, rotation)]),
  });
  const wheel = await placePart(h, "wheel", hub, 0);

  // Leave exactly the fixture on the crown, and take the rest of the ring off.
  const raised = await h.snapshot();
  for (const fixture of fixturesOf(raised, wheel)) {
    if (fixture.q !== crown.q || fixture.r !== crown.r) {
      await h.debug.removeMote(fixture.id);
    }
  }

  const west = await spawnMote(h, first, "mars");
  const east = await spawnMote(h, second, "mars");

  const posed = await h.snapshot();
  assertEqual(
    moteAt(posed, first)?.type,
    "mars",
    "one mars is on the first fount",
  );
  assertEqual(
    moteAt(posed, second)?.type,
    "mars",
    "the other mars is on the second fount, so the founts satisfy the rule",
  );
  assertNotNull(
    moteAt(posed, crown),
    "the wheel put one of its six fixtures on the crown",
  );
  assertEqual(
    moteAt(posed, crown)?.wheel,
    wheel,
    "the thing on the crown is that wheel's fixture rather than a loose mote",
  );
  assertEqual(
    fixturesOf(posed, wheel).length,
    1,
    "the rest of the ring was taken off, so the crown's fixture stands alone",
  );

  await advanceCycles(h, 1);
  await captureStill(h, "fixture-crown");

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "a waiting sigil is not a fault: the cycle reached its boundary",
  );
  assertEqual(after.sim?.cycle, 1, "one whole cycle ran, so a boundary passed");
  assertEqual(
    moteAt(after, first)?.id,
    west,
    "the mars on the first fount was not consumed",
  );
  assertEqual(moteAt(after, first)?.type, "mars", "and is still mars");
  assertEqual(
    moteAt(after, second)?.id,
    east,
    "the mars on the second fount was not consumed",
  );
  assertEqual(moteAt(after, second)?.type, "mars", "and is still mars");
  assertEqual(
    moteAt(after, crown)?.wheel,
    wheel,
    "the fixture is still the thing on the crown, unreplaced",
  );
  assertEqual(
    looseMotes(after).length,
    2,
    "the two mars are the whole of the loose motes: none was created",
  );
});
