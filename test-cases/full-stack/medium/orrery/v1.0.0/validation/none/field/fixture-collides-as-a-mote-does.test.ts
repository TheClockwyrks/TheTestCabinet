// field/fixture-collides-as-a-mote-does — a wheel's own fixture is one of the
// motes the collision rule checks.
//
// THE RULE, from `specs/field.md` (Motes): "A fixture is one of the six motes a
// zodiac wheel carries, defined in `specs/parts.md`. A fixture collides as a mote
// does". `specs/simulation.md` (Collision) is the rule it collides by — "If at any
// sample the distance between the centers of two motes is strictly less than `2 *
// MOTE_COLLIDE_R` (`38`), the run faults as `collision` at that sample, naming
// every pair within the threshold at that sample. Every pair is checked, fixtures
// included" — and its payload table gives `collision` "every mote of every pair
// within `38` at that sample", "in ascending mote id".
//
// THE CONFIGURATION IS THE ARC OF WORKED EXAMPLE A, SWEPT BY A FIXTURE. "A `wheel`
// is a hub on its anchor hex carrying six fixture motes, one on each adjacent hex"
// (`specs/parts.md`), so a wheel on `(0, 0)` carries a fixture on `(0, 0) +
// DIRS[0]` = `(1, 0)`, and "Fixtures are carried by their wheel's rotation"
// (`specs/simulation.md`). Under `rotate-cw` the hub's "direction turns 60 degrees
// about its base, clockwise", so that fixture sweeps from `(1, 0)` toward `(0, 1)`
// about `(0, 0)` — which is exactly the arc example A carries a mote along. With a
// mote resting on `(1, 1)`, the specification computes that arc's first sample
// within `38` as `36.10` at `t = 3/8`, and the outcome as "Faults".
//
// THE OTHER FIVE FIXTURES DECIDE NOTHING. They ride the same rigid rotation, so
// every distance among the six is the distance it was; and none of them comes
// near the resting mote before the sweeping one does — the next nearest is `53.70`
// at `t = 1/8`, well outside `38`. So the pair the rule finds first is the fixture
// on `(1, 0)` and the mote on `(1, 1)`.
//
// THE WHEEL GOES DOWN INTO THE LIVE RUN, which is what raises its ring: "While a
// run is live, a part one of them adds enters the run at its rest pose holding
// nothing, with a wheel's six fixtures on its spoke hexes"
// (`specs/instrumentation.md`). The bare opener emptied the field first —
// `clearMotes` "removes every mote, fixtures included" — so the six fixtures and
// the one resting mote are the whole of the world, and the wheel's own tape is the
// only motion in it.
//
// THE VERDICT. The run faults as `collision`, `sim.fraction` is the `k / 8` of the
// sample it froze on, and `sim.fault.motes` names the FIXTURE beside the resting
// mote — so the pair the rule found is a fixture-mote pair, which is only possible
// if a fixture is checked like any other mote.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNear,
  assertNotNull,
} from "../assert";
import { FRACTION_TOLERANCE, sampleFraction } from "../constants";
import { at } from "../field";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  moteAt,
  openBareRun,
  placePart,
  spawnMote,
  writeTape,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("faults as collision when a wheel's fixture sweeps within 38 of a resting mote", async () => {
  await openBareRun(h, { challenge: BARE });

  // Placed into the live run, so its six fixtures appear on its spoke hexes.
  const wheel = await placePart(h, "wheel", at(0, 0), 0);
  await writeTape(h, wheel, ["rotate-cw"]);
  const resting = await spawnMote(h, at(1, 1), "dust");

  const posed = await h.snapshot();
  const fixture = moteAt(posed, at(1, 0));
  assertNotNull(
    fixture,
    "a wheel placed into a live run carries a fixture on each of its six adjacent hexes",
  );
  assertEqual(
    fixture?.wheel,
    wheel,
    "the mote on (1, 0) is that wheel's fixture rather than a loose mote",
  );
  assertEqual(
    posed.sim?.motes.length,
    7,
    "the world is the wheel's six fixtures and the one resting mote, and nothing else",
  );

  await captureReplay(h, "fixture-collision", () => advanceCycles(h, 1));

  const sim = (await h.snapshot()).sim;
  assertNotNull(sim, "the run is still live after the cycle that faulted it");
  assertEqual(
    sim?.status,
    "faulted",
    "a fixture collides as a mote does, so the ring's sweep onto the resting mote faults",
  );
  assertEqual(
    sim?.fault?.kind,
    "collision",
    "two mote centers strictly closer than 2 * MOTE_COLLIDE_R (38) fault as collision",
  );
  assertDeepEqual(
    sim?.fault?.motes,
    [fixture?.id ?? -1, resting].sort((a, b) => a - b),
    "the fault names the fixture beside the resting mote, in ascending mote id",
  );
  assertNear(
    sim?.fraction ?? -1,
    sampleFraction(3),
    FRACTION_TOLERANCE,
    "the arc first comes within 38 at 36.10, t = 3/8, and a collision leaves the fraction at that sample's k / 8",
  );
});
