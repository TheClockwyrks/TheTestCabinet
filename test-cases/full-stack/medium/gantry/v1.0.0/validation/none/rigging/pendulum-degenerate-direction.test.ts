// rigging/pendulum-degenerate-direction — a bob that drifts onto the pivot itself
// takes the direction straight down rather than dividing by zero.
//
// `specs/rigging.md` § The pendulum tick, step 3: "`n = (p - P) / |p - P|`; if `p`
// coincides with `P`, `n = (0, -1, 0)`." The edge case is reachable and this poses
// it exactly: the bob is put ON the pivot and given the velocity
// `(0, GRAVITY / TICK_HZ, 0)`, so step 1's `v + g * dt` cancels it to zero and
// step 2's drift leaves the position on the pivot, where `|p - P|` is `0`.
//
// WHAT THE STEPS THEN GIVE, and why it is the reading below. Step 3 takes
// `(0, -1, 0)`, so step 4 puts the bob at `P - (0, L, 0)`, hanging straight down.
// Step 5's `vP` is zero — the pivot stands still, with no axis driving — and step
// 6 has a zero relative velocity to remove a radial part from and to damp, so step
// 7 leaves the bob at rest. A build that divides by zero here reports `NaN`, which
// the position reading below refuses, and one that leaves the bob on the pivot is
// `L` away from where the constraint puts it.
//
// The world holds the crane and nothing else, and the tape is one grip move,
// which "applies no force to anything": the pivot must stand still for the drift
// to land on it.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue, assertVec3Near } from "../assert";
import { GRAVITY, GRIP_MAX_RATE, TICK_HZ } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** A tape that keeps a run legal and asks nothing of the rigging. */
const HOLD_TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 360, rate: GRIP_MAX_RATE }],
  },
];

/** Arithmetic slack on a position the seven steps fix exactly. */
const TOLERANCE = 1e-9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("hangs the bob straight below a pivot its drift landed on", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, HOLD_TAPE);
  await startRun(h);
  const settled = (await runTicks(h, 1)).run;

  // On the pivot, with the velocity step 1 cancels to exactly zero.
  await h.debug.setBob(settled.pivot.x, settled.pivot.y, settled.pivot.z);
  await h.debug.setBobVelocity(0, GRAVITY / TICK_HZ, 0);
  const after = (await runTicks(h, 1)).run;

  await h.capture("degenerate", "The bob resolved from the pivot itself");

  assertVec3Near(
    after.bob.pos,
    {
      x: after.pivot.x,
      y: after.pivot.y - after.axes.hoist.value,
      z: after.pivot.z,
    },
    TOLERANCE,
    "the bob after a tick whose drift left it on the pivot: the pivot minus " +
      "(0, L, 0), the direction (0, -1, 0) step 3 takes there " +
      "(specs/rigging.md)",
  );
  assertTrue(
    Number.isFinite(after.bob.vel.x) &&
      Number.isFinite(after.bob.vel.y) &&
      Number.isFinite(after.bob.vel.z),
    "the bob's velocity is a number after the degenerate direction, rather " +
      "than the NaN a division by zero leaves (specs/rigging.md)",
  );
});
