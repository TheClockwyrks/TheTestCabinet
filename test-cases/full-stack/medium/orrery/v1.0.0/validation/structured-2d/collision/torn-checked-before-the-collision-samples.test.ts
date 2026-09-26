// collision/torn-checked-before-the-collision-samples — a machine that is both
// torn and colliding reports `torn`.
//
// THE RULE, in the cycle order: "4. Motion. The moving parts sweep across the
// cycle, as the next section defines, with the torn check at its start and the
// collision check at each sample" (`specs/simulation.md`, Cycles and the clock).
// The torn check therefore runs first, and "a fault freezes the run where it
// stood ... nothing advances further" (Faults), so the samples that would have
// found the collision are never taken.
//
// THE CONFIGURATION is the tear of the item above laid over example A's geometry,
// so BOTH faults are available in the one cycle:
//
//   * an arm anchored on `(0, 0)` at rotation `0`, gripper `(1, 0)`, tape
//     `rotate-cw`;
//   * an arm anchored on `(2, 0)` at rotation `3`, gripper also `(1, 0)`, tape
//     blank — "A blank cell is a rest", so it imposes no motion;
//   * one mote on `(1, 0)`, held by both, so the imposed motions disagree;
//   * one mote resting on `(1, 1)`, which is exactly example A: were the rotation
//     to happen, the carried mote would come within `38` of it at `36.10`,
//     `t = 3/8`.
//
// THE VERDICT. `sim.fault.kind` is `torn` and not `collision`, and `sim.fraction`
// is `0` rather than a sample's `k / 8` — "A `collision` leaves the fraction at
// that sample's `k / 8`; every other fault and completion leaves it at `0`" — so
// the run stopped before the samples were reached rather than after.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertNear,
  assertNotEqual,
  assertNotNull,
} from "../assert";
import { FRACTION_TOLERANCE } from "../constants";
import { at } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  openBareRun,
  partIds,
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

it("raises torn rather than the collision the same cycle would have reached", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", 0, 0, 0, 1, ["rotate-cw"]),
      armPart("arm", 2, 0, 3, 1, []),
    ]),
  });
  const placed = await partIds(h);
  const carried = await spawnMote(h, at(1, 0), "dust");
  await takeGrip(h, placed[0] ?? -1, 0, carried);
  await takeGrip(h, placed[1] ?? -1, 3, carried);
  await spawnMote(h, at(1, 1), "dust");

  await captureReplay(h, "torn-wins", () => advanceCycles(h, 1));

  const sim = (await h.snapshot()).sim;
  assertNotNull(sim, "the run is still live after the fault");
  assertEqual(
    sim?.status,
    "faulted",
    "the cycle faults rather than completing",
  );
  assertNotEqual(
    sim?.fault?.kind,
    "collision",
    "the collision samples are never reached, because the torn check runs first",
  );
  assertEqual(
    sim?.fault?.kind,
    "torn",
    "the torn check runs at the start of the motion step",
  );
  assertNear(
    sim?.fraction ?? -1,
    0,
    FRACTION_TOLERANCE,
    "every fault but a collision leaves the fraction at 0, so no sample was taken",
  );
});
