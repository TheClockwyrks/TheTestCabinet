// simulation/grab-over-a-fixture-holds-nothing — a gripper closing over a wheel's
// fixture takes nothing.
//
// THE RULE. "3. Grabs. Every gripper of every part whose instruction is `grab`
// closes; a gripper over a mote that is NOT A FIXTURE takes hold of that mote's
// constellation. A gripper over a fixture or over nothing closes on nothing"
// (`specs/simulation.md`). The fixture stays with the wheel that carries it:
// "Fixtures are carried by their wheel's rotation and rest otherwise" (Motion and
// carrying), and "A `wheel` is a hub on its anchor hex carrying six fixture motes,
// one on each adjacent hex" (`specs/parts.md`).
//
// THE CONFIGURATION. A wheel on `(0, 0)`, placed INTO the live run so its six
// fixtures appear on its spoke hexes — "a part one of them adds enters the run at
// its rest pose holding nothing, with a wheel's six fixtures on its spoke hexes"
// (`specs/instrumentation.md`) — with a blank tape, which "is a rest on every
// part, a wheel included, and never faults", so the ring does not turn. The bare
// opener emptied the field first, so the six fixtures and one loose mote are the
// whole of the world.
//
// A `biarm` on `(2, 0)` at rotation `3`, length `1`, carries "two grippers, on
// opposite spokes" (`specs/parts.md`) at `(2, 0) + DIRS[3]` = `(1, 0)` and
// `(2, 0) + DIRS[0]` = `(3, 0)`. `(1, 0)` is the wheel's spoke-`0` fixture hex;
// `(3, 0)` holds one ordinary mote. The biarm's tape holds `grab` alone.
//
// THE SECOND GRIPPER IS THE CONTROL. One `grab` closes both grippers of the part,
// so the two hexes are read out of the SAME grab step: the one over the loose mote
// must take hold, and the one over the fixture must not. A build whose grab step
// does nothing at all fails the control; a build that grabs fixtures fails the
// subject. Neither can pass by standing still.
//
// Nothing moves — `grab` and a blank both impose no motion — so the six fixtures
// stay `HEX_PITCH` (`48`) from one another and the loose mote stands `96` from the
// nearest fixture, all outside the `38` the collision rule watches.
//
// THE VERDICT. The run reports exactly one grip for the biarm, on the spoke over
// the loose mote. No grip names the spoke over the fixture, and that fixture is
// still on `(1, 0)`, still naming its wheel.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { at } from "../field";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  gripsOf,
  heldBy,
  moteAt,
  openBareRun,
  placePart,
  spawnMote,
  writeTape,
  type Harness,
} from "../harness";

/** The biarm's spoke over the wheel's fixture, and its opposite over the mote. */
const OVER_FIXTURE = 3;
const OVER_MOTE = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes the loose mote and leaves the fixture with its wheel", async () => {
  await openBareRun(h, { challenge: BARE });

  // Placed into the live run, so its six fixtures appear on its spoke hexes.
  const wheel = await placePart(h, "wheel", at(0, 0), 0);
  const biarm = await placePart(h, "biarm", at(2, 0), OVER_FIXTURE);
  await writeTape(h, biarm, ["grab"]);
  const loose = await spawnMote(h, at(3, 0), "dust");

  const posed = await h.snapshot();
  const fixture = moteAt(posed, at(1, 0));
  assertNotNull(
    fixture,
    "a wheel placed into a live run carries a fixture on each of its six adjacent hexes",
  );
  assertEqual(
    fixture?.wheel,
    wheel,
    "the mote under the biarm's first gripper is that wheel's fixture rather than a loose mote",
  );
  assertLength(
    posed.sim?.motes ?? [],
    7,
    "the world is the wheel's six fixtures and the one loose mote, and nothing else",
  );

  await advanceCycles(h, 1);
  await captureStill(h, "empty");

  const boundary = await h.snapshot();
  assertEqual(
    boundary.sim?.status,
    "running",
    "grab and a blank both impose no motion, so no pair of motes comes within 38",
  );
  assertEqual(
    heldBy(boundary, biarm, OVER_MOTE),
    loose,
    "the gripper over an ordinary mote takes hold, so the grab step really ran",
  );
  assertNull(
    heldBy(boundary, biarm, OVER_FIXTURE),
    "a gripper over a fixture closes on nothing, so no grip appears for that spoke",
  );
  assertLength(
    gripsOf(boundary, biarm),
    1,
    "one of the biarm's two grippers holds: the one that was not over a fixture",
  );

  const after = moteAt(boundary, at(1, 0));
  assertNotNull(
    after,
    "the fixture is still on the hex the gripper closed over",
  );
  assertEqual(
    after?.id,
    fixture?.id,
    "the fixture the gripper closed over is the fixture still standing there",
  );
  assertEqual(
    after?.wheel,
    wheel,
    "the fixture stays with its wheel: nothing took it off the ring",
  );
});
