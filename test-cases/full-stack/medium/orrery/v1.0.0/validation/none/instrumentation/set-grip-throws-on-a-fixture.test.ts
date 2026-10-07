// instrumentation/set-grip-throws-on-a-fixture — a wheel's fixture is never
// carried by an arm.
//
// THE RULE. "`setGrip(part, spoke, mote)` | ... A part with no gripper on that
// spoke, a mote resting anywhere but that gripper's hex, and A FIXTURE each
// throw." (`specs/instrumentation.md`, The run). The simulation says the same
// thing from the other side: at the grab step, "a gripper over a mote that is not
// a fixture takes hold of that mote's constellation. A gripper over a fixture or
// over nothing closes on nothing" (`specs/simulation.md`).
//
// THE WORLD IS POSED, NOT SEARCHED. A bare run with one arm on `(2, 0)` at
// rotation `3`, so its single gripper stands on `(1, 0)` — west of its base, by
// `base + length * DIRS[3]` (`specs/parts.md`). A wheel is then placed at the
// middle while the run is live, which raises its six fixtures, and the one on
// spoke `0` stands on `(1, 0)`: the arm's gripper hex exactly. So the part carries
// a gripper on the spoke named, and the mote named IS resting on that gripper's
// hex — the two other rules that could refuse the call are both satisfied, and
// only the fixture rule is left.
//
// THE VERDICT. The call throws an `Error`, `sim.grips` is empty, and the fixture
// is still its wheel's, resting on the hex it was raised on.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertTrue,
} from "../assert";
import { at } from "../field";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  fixturesOf,
  moteAt,
  moteById,
  openBareRun,
  partIds,
  placePart,
  type Harness,
} from "../harness";

/** The arm's gripper hex, and the wheel's spoke `0` fixture hex: one hex. */
const SHARED_HEX = at(1, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("throws on a fixture under the gripper, and adds no grip", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("arm", 2, 0, 3, 1, [])]),
  });
  const arm = (await partIds(h))[0] ?? -1;
  const wheel = await placePart(h, "wheel", ORIGIN, 0);
  const before = await h.snapshot();
  const fixture = moteAt(before, SHARED_HEX)?.id ?? -1;

  const refusal = await refusalOf(() => h.debug.setGrip(arm, 3, fixture));
  const after = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "refused");

  assertNotNull(before.sim, "the run is live at the refused call");
  assertLength(
    fixturesOf(before, wheel),
    6,
    "the wheel raised its ring, so the mote under the gripper is one of its fixtures",
  );
  assertEqual(
    moteAt(before, SHARED_HEX)?.wheel,
    wheel,
    "the mote resting on the arm's gripper hex belongs to the wheel",
  );
  assertTrue(
    refusal instanceof Error,
    "setGrip naming a fixture throws an Error, however squarely it sits under the gripper",
  );
  assertLength(
    after.sim?.grips ?? [],
    0,
    "the refused call added no grip, so a fixture is never carried by an arm",
  );
  assertEqual(
    moteById(after, fixture)?.wheel,
    wheel,
    "the fixture is left on its wheel",
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
