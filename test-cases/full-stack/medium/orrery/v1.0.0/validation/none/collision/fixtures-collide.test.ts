// collision/fixtures-collide — a wheel's fixtures are checked like any other mote.
//
// THE RULE. "Every pair is checked, fixtures included" (`specs/simulation.md`,
// Collision), and `specs/field.md` says the same from the fixture's side: "A
// fixture is one of the six motes a zodiac wheel carries ... A fixture collides as
// a mote does."
//
// THE CONFIGURATION is example A's sweep with the resting mote replaced by a
// FIXTURE. "A `wheel` is a hub on its anchor hex carrying six fixture motes, one
// on each adjacent hex" (`specs/parts.md`), so a wheel anchored on `(2, 1)` puts a
// fixture on `(2, 1) + DIRS[3]` = `(1, 1)` — exactly where example A rests its
// mote, which the specification computes as `36.10` at `t = 3/8`, within `38`. The
// wheel's tape is left blank, "which every part rests on"
// (`specs/instrumentation.md`), so the ring stands still and the only motion in the
// world is the arm's sweep.
//
// THE WHEEL IS PLACED INTO THE LIVE RUN, which is what raises its ring: "While a
// run is live, a part one of them adds enters the run at its rest pose holding
// nothing, with a wheel's six fixtures on its spoke hexes"
// (`specs/instrumentation.md`). The bare opener cleared the field first —
// `clearMotes` "removes every mote, fixtures included" — so the six fixtures and
// the one carried mote are the whole of the world.
//
// THE VERDICT. The run faults as `collision`, and `sim.fault.motes` names the
// FIXTURE beside the carried mote, so the pair the rule found is a fixture-mote
// pair rather than two loose motes.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNear,
  assertNotNull,
} from "../assert";
import { FRACTION_TOLERANCE, sampleFraction } from "../constants";
import { at } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  moteAt,
  openBareRun,
  partIds,
  placePart,
  spawnMote,
  takeGrip,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("faults as collision when a carried mote comes within 38 of a wheel's fixture", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("arm", 0, 0, 0, 1, ["rotate-cw"])]),
  });
  const arm = (await partIds(h))[0] ?? -1;

  // The wheel goes down into the live run, so its six fixtures appear.
  const wheel = await placePart(h, "wheel", at(2, 1), 0);
  const carried = await spawnMote(h, at(1, 0), "dust");
  await takeGrip(h, arm, 0, carried);

  const posed = await h.snapshot();
  const fixture = moteAt(posed, at(1, 1));
  assertNotNull(
    fixture,
    "a wheel placed into a live run puts a fixture on each of its six spoke hexes",
  );
  assertEqual(
    fixture?.wheel,
    wheel,
    "the mote on (1, 1) is that wheel's fixture rather than a loose mote",
  );

  await captureReplay(h, "faulted", () => advanceCycles(h, 1));

  const sim = (await h.snapshot()).sim;
  assertEqual(
    sim?.status,
    "faulted",
    "a fixture is checked like any other mote, so the sweep onto it faults",
  );
  assertEqual(
    sim?.fault?.kind,
    "collision",
    "the pair within 38 is a collision",
  );
  assertDeepEqual(
    sim?.fault?.motes,
    [carried, fixture?.id].sort((a, b) => (a as number) - (b as number)),
    "the fault names the fixture beside the carried mote, in ascending mote id",
  );
  assertNear(
    sim?.fraction ?? -1,
    sampleFraction(3),
    FRACTION_TOLERANCE,
    "the sweep first comes within 38 at t = 3/8, and a collision freezes there",
  );
});
