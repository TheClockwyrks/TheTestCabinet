// instrumentation/mid-run-part-leaves-with-what-it-holds — what a part takes off
// the field with it when it is removed from a live run.
//
// THE RULE, the last of the five that hold across the whole machine group: "While
// a run is live, a part one of them adds enters the run at its rest pose holding
// nothing, with a wheel's six fixtures on its spoke hexes, and a part one of them
// removes takes its live pose, its grips, and its fixtures off the field with it"
// (`specs/instrumentation.md`, The machine).
//
// THE SECOND HALF ALONE IS DECIDED HERE, in one direction: what `removePart`
// takes. Three readings go with the part — its entry in `sim.poses`, its entries
// in `sim.grips`, and, for a wheel, its six fixtures in `sim.motes` — and a fourth
// thing is deliberately NOT among them. A mote the part merely CARRIED is not its
// pose, not its grip and not its fixture, so nothing takes it off the field; it is
// left exactly where an opened gripper leaves what it held, "resting where it
// stands" (`specs/instrumentation.md`, `releaseGrip`), on the hex it stood on.
//
// THE WORLD IS POSED, NOT SEARCHED. The run is opened on a posed challenge with a
// machine of exactly two parts — one arm and one wheel, far enough apart that
// neither's hexes can meet the other's — and the completion switch is held off, so
// the only autonomous consequence there is cannot fire. The field is left as
// `startRun` raised it, which on a machine with no rise is the wheel's six
// fixtures and nothing else, and the one loose mote the check spawns back. The
// hold is given with `setGrip`, "which takes hold with no `grab` ever running", so
// no cycle runs before the removal.
//
// EVERY READING IS TAKEN TWICE, before the removal and after it, because a build
// that never placed the pose, the grip or the fixtures at all would satisfy an
// "it is gone" reading for the wrong reason.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  fixturesOf,
  gripsOf,
  heldBy,
  holdCompletion,
  moteAt,
  moteById,
  openRun,
  partIds,
  poseOf,
  spawnMote,
  takeGrip,
  type Harness,
} from "../harness";
import { BARE, ORIGIN, WEST } from "../fixtures";
import { armPart, solution } from "../formats";
import { gripperHex } from "../parts";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes the removed part's pose, grips and fixtures, and leaves what it carried", async () => {
  await openRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, []),
      armPart("wheel", WEST.q, WEST.r, 0, 1, []),
    ]),
  });
  await holdCompletion(h);
  const [arm, wheel] = await partIds(h);
  const carried = await spawnMote(h, gripperHex(ORIGIN, 0, 1), "dust");
  await takeGrip(h, arm as number, 0, carried);

  const before = await h.snapshot();
  assertNotNull(
    poseOf(before, arm as number),
    "the arm has a live pose before it is removed",
  );
  assertEqual(
    heldBy(before, arm as number, 0),
    carried,
    "the arm's gripper is holding the spawned mote before the removal",
  );
  assertNotNull(
    poseOf(before, wheel as number),
    "the wheel has a live pose before it is removed",
  );
  assertLength(
    fixturesOf(before, wheel as number),
    6,
    "startRun placed the wheel's six fixtures",
  );

  await captureReplay(h, "removed", async () => {
    await h.advance(1);
    await h.debug.removePart(arm as number);
    await h.debug.removePart(wheel as number);
    await advanceCycles(h, 1);
  });

  const after = await h.snapshot();
  assertNotNull(after.sim, "the run is still live after the two removals");
  assertNull(
    poseOf(after, arm as number),
    "a removed part takes its live pose out of sim.poses",
  );
  assertLength(
    gripsOf(after, arm as number),
    0,
    "a removed part takes its grips out of sim.grips",
  );
  assertNull(
    poseOf(after, wheel as number),
    "a removed wheel takes its live pose out of sim.poses",
  );
  assertLength(
    fixturesOf(after, wheel as number),
    0,
    "a removed wheel takes its fixtures out of sim.motes",
  );

  const left = moteById(after, carried);
  assertNotNull(
    left,
    "a mote the removed part merely carried is none of its pose, its grips or its fixtures, so it stays on the field",
  );
  assertEqual(
    moteAt(after, gripperHex(ORIGIN, 0, 1))?.id,
    carried,
    "what the removed gripper held is left resting where it stood",
  );
  assertLength(
    after.sim?.motes ?? [],
    1,
    "the six fixtures went with the wheel, and the carried mote alone is left",
  );
});
