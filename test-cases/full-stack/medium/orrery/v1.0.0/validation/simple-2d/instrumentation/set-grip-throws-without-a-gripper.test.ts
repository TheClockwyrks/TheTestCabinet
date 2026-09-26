// instrumentation/set-grip-throws-without-a-gripper — a spoke the part carries no
// gripper on refuses the hold.
//
// THE RULE. "`setGrip(part, spoke, mote)` | ... A part with no gripper on that
// spoke, a mote resting anywhere but that gripper's hex, and a fixture each
// throw." (`specs/instrumentation.md`, The run). Which spokes a part carries is
// fixed by `specs/parts.md`: an `arm` carries one, "`rotation`", and "A `wheel` is
// a hub on its anchor hex carrying six fixture motes... Its anatomy is the hub and
// its ring alone" — a wheel has no gripper on any spoke.
//
// THE WORLD IS POSED, NOT SEARCHED. A bare run with one arm on `(-3, 0)` at
// rotation `0`, so its single gripper stands on `(-2, 0)` and spoke `1` is a spoke
// it does not carry. A mote is spawned on `(-3, 1)`, which IS the hex a gripper on
// spoke `1` would stand on — so the refusal cannot be the mote resting elsewhere.
// A wheel is placed while the run is live, its fixture on spoke `0` is removed and
// a loose `dust` spawned in its place — so the mote on the wheel's spoke hex is
// not a fixture either, and the only rule left to refuse the call is the one this
// point is about.
//
// THE VERDICT. Both calls throw an `Error` and `sim.grips` is empty afterwards: no
// grip was added by either.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertNotNull, assertTrue } from "../assert";
import { at } from "../field";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN, WEST } from "../fixtures";
import {
  captureStill,
  createHarness,
  moteAt,
  openBareRun,
  partIds,
  placePart,
  spawnMote,
  type Harness,
} from "../harness";

/** The hex a gripper on the arm's spoke `1` would stand on: `(-3, 0) + DIRS[1]`. */
const SPOKE_ONE_HEX = at(-3, 1);

/** The wheel's spoke `0` hex, cleared of its fixture for the second call. */
const WHEEL_SPOKE_HEX = at(1, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("throws on a spoke the part carries no gripper on, and adds no grip", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("arm", WEST.q, WEST.r, 0, 1, [])]),
  });
  const arm = (await partIds(h))[0] ?? -1;
  const wheel = await placePart(h, "wheel", ORIGIN, 0);
  const beside = await spawnMote(h, SPOKE_ONE_HEX, "dust");

  // Clearing the wheel's own fixture off that hex is what makes room for the
  // loose mote. A build whose wheel raised no fixture has nothing standing there
  // to clear, and "a part or a mote no id names" is invalid and "fails loudly"
  // (`specs/instrumentation.md`) — so the removal is skipped rather than becoming
  // this point's failure. Either way the reading below checks that what ends up
  // on the hex is a loose mote and not a fixture, which is the whole of what the
  // arrangement is for.
  const raised = await h.snapshot();
  const standing = moteAt(raised, WHEEL_SPOKE_HEX)?.id ?? null;
  if (standing !== null) await h.debug.removeMote(standing);
  const loose = await spawnMote(h, WHEEL_SPOKE_HEX, "dust");
  const before = await h.snapshot();

  const onNoSpoke = await refusalOf(() => h.debug.setGrip(arm, 1, beside));
  const wheelSpoke = await refusalOf(() => h.debug.setGrip(wheel, 0, loose));
  const after = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "refused");

  assertNotNull(before.sim, "the run is live at the refused calls");
  assertLength(
    before.sim?.grips ?? [],
    0,
    "no gripper holds anything before the calls",
  );
  assertTrue(
    moteAt(before, WHEEL_SPOKE_HEX)?.wheel === null,
    "the mote on the wheel's spoke hex is a loose mote rather than a fixture, so the refusal is not the fixture rule",
  );
  assertTrue(
    onNoSpoke instanceof Error,
    "setGrip on spoke 1 of an arm, which carries a gripper on its rotation alone, throws an Error",
  );
  assertTrue(
    wheelSpoke instanceof Error,
    "setGrip on any spoke of a wheel, whose anatomy is the hub and its ring alone, throws an Error",
  );
  assertLength(after.sim?.grips ?? [], 0, "neither refused call added a grip");
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
