// rigging/pendulum-gravity-step — the tick begins by adding gravity to the bob's
// velocity, and that is the only thing that sets a hanging bob moving.
//
// `specs/rigging.md` § The pendulum tick, step 1: "Gravity: `v = v + g * dt`,
// with `g = (0, -GRAVITY, 0)`", with `dt = 1 / TICK_HZ`. Nothing else in the
// seven steps adds motion: steps 2 to 4 move the position, step 5 reads the
// pivot's own motion, and steps 6 and 7 only take motion away and recompose it.
//
// SO THE BOB IS POSED WHERE STEP 1 IS THE WHOLE STORY: at rest, on the sphere,
// with the cable horizontal — the pivot plus `(L, 0, 0)`. There the cable's
// direction is horizontal, so the gravity step's `-GRAVITY * dt` on `y` is very
// nearly tangential and step 6 keeps almost all of it; the bob leaves the tick
// falling at `0.1665` a second. A build that skips step 1 leaves it exactly where
// it was posed, at rest, which the reading below is `1.6e8` tolerances away from.
//
// ONLY THE POSITION IS POSED. The velocity is the zero the previous tick left on
// a bob hanging at rest, so this depends on nothing about how a posed velocity is
// carried into a tick, and the run's first tick is behind us so nothing here is
// the first tick's special case.
//
// The expected velocity is the seven steps as the specification writes them,
// applied to the state the build itself reports the tick began at. The pivot
// stands still through the tick, so step 5's `vP` is zero and step 7 recomposes
// the relative velocity alone; both are read from the run rather than assumed.

import { afterEach, beforeEach, it } from "vitest";
import { assertVec3Near } from "../assert";
import { GRAVITY, GRIP_MAX_RATE, SWING_DAMPING, TICK_HZ } from "../constants";
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
  type Vec3,
} from "../harness";

/** A tape that keeps a run legal and asks nothing of the rigging. */
const HOLD_TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 360, rate: GRIP_MAX_RATE }],
  },
];

/** Arithmetic slack on a velocity the seven steps fix exactly. */
const TOLERANCE = 1e-9;

const DT = 1 / TICK_HZ;

/** Steps 1 to 7 of `specs/rigging.md` § The pendulum tick, in order. */
function pendulumTick(
  p: Vec3,
  v: Vec3,
  pivotPrev: Vec3,
  pivot: Vec3,
  length: number,
): { pos: Vec3; vel: Vec3 } {
  const gravity: Vec3 = { x: v.x, y: v.y - GRAVITY * DT, z: v.z };
  const drifted: Vec3 = {
    x: p.x + gravity.x * DT,
    y: p.y + gravity.y * DT,
    z: p.z + gravity.z * DT,
  };
  const away: Vec3 = {
    x: drifted.x - pivot.x,
    y: drifted.y - pivot.y,
    z: drifted.z - pivot.z,
  };
  const span = Math.hypot(away.x, away.y, away.z);
  const n: Vec3 =
    span === 0
      ? { x: 0, y: -1, z: 0 }
      : { x: away.x / span, y: away.y / span, z: away.z / span };
  const pos: Vec3 = {
    x: pivot.x + length * n.x,
    y: pivot.y + length * n.y,
    z: pivot.z + length * n.z,
  };
  const vP: Vec3 = {
    x: (pivot.x - pivotPrev.x) / DT,
    y: (pivot.y - pivotPrev.y) / DT,
    z: (pivot.z - pivotPrev.z) / DT,
  };
  const relative: Vec3 = {
    x: gravity.x - vP.x,
    y: gravity.y - vP.y,
    z: gravity.z - vP.z,
  };
  const radial = relative.x * n.x + relative.y * n.y + relative.z * n.z;
  const damping = 1 - SWING_DAMPING * DT;
  const tangential: Vec3 = {
    x: (relative.x - radial * n.x) * damping,
    y: (relative.y - radial * n.y) * damping,
    z: (relative.z - radial * n.z) * damping,
  };
  return {
    pos,
    vel: {
      x: vP.x + tangential.x,
      y: vP.y + tangential.y,
      z: vP.z + tangential.z,
    },
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts a bob at rest on the horizontal falling, by g * dt", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, HOLD_TAPE);
  await startRun(h);
  const settled = (await runTicks(h, 1)).run;

  // The cable horizontal: the pivot plus (L, 0, 0), on the sphere and at rest.
  const L = settled.axes.hoist.value;
  await h.debug.setBob(settled.pivot.x + L, settled.pivot.y, settled.pivot.z);
  const before = (await h.snapshot()).run;
  const after = (await runTicks(h, 1)).run;

  await h.capture("fall", "The bob starting to fall from the horizontal");

  const expected = pendulumTick(
    before.bob.pos,
    before.bob.vel,
    before.pivot,
    after.pivot,
    after.axes.hoist.value,
  );

  assertVec3Near(
    after.bob.vel,
    expected.vel,
    TOLERANCE,
    "the velocity one tick leaves a bob posed at rest with the cable " +
      "horizontal, whose only source of motion is step 1's -GRAVITY * dt on " +
      "y (specs/rigging.md); a build that skips that step leaves the bob at " +
      "rest",
  );
});
