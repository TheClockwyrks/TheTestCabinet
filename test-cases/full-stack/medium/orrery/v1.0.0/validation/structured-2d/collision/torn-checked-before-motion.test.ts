// collision/torn-checked-before-motion — a tear is raised before the holders move.
//
// THE RULE. "At the start of the motion step, every held constellation's imposed
// motions must agree: each holding gripper imposes the motion of its own part's
// instruction, and unless every imposed motion is the same one, the run faults as
// `torn`" (`specs/simulation.md`, Held more than once). The cycle order puts the
// check there too: "4. Motion. The moving parts sweep across the cycle ... with
// the torn check at its start". And a fault "freezes the run where it stood", with
// "every other fault and completion leaves it at `0`" fixing the fraction.
//
// THE CONFIGURATION. One mote on `(1, 0)`, held by two grippers that would impose
// different motions:
//
//   * an arm anchored on `(0, 0)` at rotation `0`, whose gripper is `(1, 0)`, with
//     `rotate-cw` on its tape — a rotation about `(0, 0)`;
//   * an arm anchored on `(2, 0)` at rotation `3`, whose gripper is also `(1, 0)`
//     (`DIRS[3]` is `(-1, 0)`), with a BLANK tape — "A blank cell is a rest",
//     which imposes no motion.
//
// A rotation and no motion are not the same motion, so the constellation is torn.
// Both holds are given with `setGrip`, "which takes hold with no `grab` ever
// running", so no earlier cycle has moved either arm.
//
// THE VERDICT. Every part `sim.fault.parts` names reports the rotation, length and
// cell it held when the cycle began: the tear was raised before the motion
// happened, so the rotating arm never took its 60 degree step. `sim.fraction` is
// `0`, because the freeze is at the start of the motion step rather than at a
// collision sample.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertNear,
  assertNotNull,
} from "../assert";
import { FRACTION_TOLERANCE } from "../constants";
import { at } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  openBareRun,
  partIds,
  poseOf,
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

it("freezes every named part at the pose it held when the cycle began", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", 0, 0, 0, 1, ["rotate-cw"]),
      armPart("arm", 2, 0, 3, 1, []),
    ]),
  });
  const placed = await partIds(h);
  const turner = placed[0] ?? -1;
  const rester = placed[1] ?? -1;
  const mote = await spawnMote(h, at(1, 0), "dust");
  await takeGrip(h, turner, 0, mote);
  await takeGrip(h, rester, 3, mote);

  const before = await h.snapshot();
  await advanceCycles(h, 1);
  await h.advance(1);
  await captureStill(h, "unmoved");

  const after = await h.snapshot();
  const sim = after.sim;
  assertNotNull(sim, "the run is still live after the tear");
  assertEqual(
    sim?.fault?.kind,
    "torn",
    "a rotation and no motion do not agree, so the constellation is torn",
  );
  assertGreaterThan(
    sim?.fault?.parts.length ?? 0,
    0,
    "a torn fault names the parts holding the constellation",
  );
  for (const part of sim?.fault?.parts ?? []) {
    // Read the pose first, so a run reporting NO pose for a named part fails
    // here rather than comparing one absent reading against another and passing
    // on the strength of both being missing.
    assertNotNull(
      poseOf(after, part),
      `part ${part} is named by the fault, so the run reports a live pose for it`,
    );
    assertDeepEqual(
      poseOf(after, part),
      poseOf(before, part),
      `part ${part} reports the rotation, length and cell it held when the cycle began`,
    );
  }
  assertNear(
    sim?.fraction ?? -1,
    0,
    FRACTION_TOLERANCE,
    "every fault but a collision leaves the fraction at 0",
  );
});
