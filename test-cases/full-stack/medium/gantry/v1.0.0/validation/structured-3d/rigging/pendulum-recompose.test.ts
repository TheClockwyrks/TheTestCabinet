// rigging/pendulum-recompose — the velocity a tick leaves is the pivot's own plus
// the constrained, damped relative velocity.
//
// `specs/rigging.md` § The pendulum tick, step 7: "Recompose: `v = vP + vr`". The
// bob's velocity is kept in the world frame while steps 6 and 7 do their work
// relative to the pivot, so what the tick ends with must carry the pivot's motion
// with it: a bob hanging under a trolley that is running out along the track is
// travelling with it, not left behind.
//
// THE READING TAKES THE DIFFERENCE. `vr` — the relative velocity after its radial
// part is removed and the swing damped — is computed from the state the build
// itself reports the tick began at, and subtracted from the velocity the tick
// left. What remains must be `vP`, the pivot's own velocity, which the two
// snapshots either side of the tick give as `(P - P_prev) / dt`. A build that
// stopped at step 6 and left `v = vr` leaves that difference at zero instead,
// which on this tick is `2` units a second away.
//
// THE TROLLEY IS CRUISING, AND THE CRUISE IS POSED RATHER THAN DRIVEN TO. The
// tape commands the trolley out to `3.5` at `2` units a second; the first tick
// takes that step, which is what makes the command live, and the trolley's rate
// is then posed to the `2` the cruise runs at. `specs/instrumentation.md` gives
// that pose exactly this meaning — "Posing a rate onto an axis that is under a
// command sets what that axis is doing as the controller next reads it" — and the
// controller, reading a rate already at the commanded one with the target still
// three units away, holds it there. So the reading is taken inside the cruise
// (`specs/program.md`) a few ticks later instead of thirty ticks of ramp later.
//
// THE RAMP IS NOT WHAT THIS DECIDES. Driving the axis up to speed first would put
// the acceleration clamp between a build and step 7 of the pendulum tick, and a
// build that ramps wrongly has its own point to fail; the route would make this
// grade less precise. The rate is a PRECONDITION and the recomposition is still
// earned: `vP` is read from the two pivots the build's own ticks reported, and
// `vr` from the state the build says the tick began at.
//
// The world holds the crane and nothing else, and the sampling stops well inside
// the move so no tick of it is the one that ends the run, with the bob swinging
// where the ticks before it left it.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear, assertVec3Near } from "../assert";
import { GRAVITY, SWING_DAMPING, TICK_HZ, TROLLEY_ACCEL } from "../constants";
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

/** The rate the trolley cruises at: half its maximum, reached in 30 ticks. */
const RATE = 2;

/** One trolley move, well inside the track's length of 4. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "trolley", target: 3.5, rate: RATE }],
  },
];

/** Ticks driven after the cruise is posed, before the reading is taken. */
const SETTLE = 3;

/** Arithmetic slack on a velocity the seven steps fix exactly. */
const TOLERANCE = 1e-9;

const DT = 1 / TICK_HZ;

/** Steps 1 to 6 of `specs/rigging.md`: the constrained, damped `vr`. */
function relativeVelocity(
  p: Vec3,
  v: Vec3,
  pivotPrev: Vec3,
  pivot: Vec3,
): Vec3 {
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
  return {
    x: (relative.x - radial * n.x) * damping,
    y: (relative.y - radial * n.y) * damping,
    z: (relative.z - radial * n.z) * damping,
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the bob carrying the pivot's velocity as well as its swing", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);

  // The first tick takes the tape's step, which is what puts the trolley under a
  // live command; the rate posed onto it then stands (specs/instrumentation.md).
  await runTicks(h, 1);
  await h.debug.setAxisRate("trolley", RATE);

  const before = (await runTicks(h, SETTLE)).run;
  const after = (await runTicks(h, 1)).run;

  await h.capture("carry", "The bob carried by the cruising trolley");

  // The precondition, read back off the build: the trolley really is cruising at
  // RATE on the tick the reading is taken, so the pivot this compares against is
  // moving and the scenario is the one described. One acceleration step of slack,
  // because a build is free to clamp the posed rate once before it holds it
  // (specs/program.md § Axis motion).
  assertNear(
    after.axes.trolley.rate,
    RATE,
    TROLLEY_ACCEL / TICK_HZ,
    "the trolley's rate on the tick the reading is taken: the cruise this " +
      "check poses, which the controller holds while the target is still " +
      "units away (specs/instrumentation.md, specs/program.md)",
  );

  const vr = relativeVelocity(
    before.bob.pos,
    before.bob.vel,
    before.pivot,
    after.pivot,
  );
  const vP: Vec3 = {
    x: (after.pivot.x - before.pivot.x) / DT,
    y: (after.pivot.y - before.pivot.y) / DT,
    z: (after.pivot.z - before.pivot.z) / DT,
  };

  assertVec3Near(
    {
      x: after.bob.vel.x - vr.x,
      y: after.bob.vel.y - vr.y,
      z: after.bob.vel.z - vr.z,
    },
    vP,
    TOLERANCE,
    "the velocity the tick left, less the constrained and damped relative " +
      "velocity, which step 7 recomposes from the pivot's own velocity " +
      `(${vP.x.toFixed(3)}, ${vP.y.toFixed(3)}, ${vP.z.toFixed(3)}) ` +
      "(specs/rigging.md); a build that stopped at step 6 leaves zero here",
  );
});
