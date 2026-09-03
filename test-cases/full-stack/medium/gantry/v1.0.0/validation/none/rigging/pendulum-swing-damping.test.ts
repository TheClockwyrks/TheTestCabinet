// rigging/pendulum-swing-damping — the swing loses `SWING_DAMPING * dt` of itself
// every tick.
//
// `specs/rigging.md` § The pendulum tick, step 6: the relative velocity has its
// radial part removed and is then damped, "`vr = vr * (1 - SWING_DAMPING * dt)`
// with `SWING_DAMPING` (`0.05`)". The factor is `1 - 0.05 / 60`, so a swing keeps
// `0.99916667` of itself each tick: on the `2` units a second posed below that is
// `1.7e-3` a tick, nearly two million times the tolerance this reading allows.
//
// THE PIVOT STANDS STILL AND THE BOB IS POSED SWINGING. With no axis driving the
// trolley or the slew, step 5's `vP` is zero, so the whole of the bob's velocity
// is the relative velocity the damping applies to and the reading is about the
// factor alone. The bob is posed on the sphere at forty-five degrees off the
// vertical with its velocity along the tangent there, which is a swing rather
// than a fall: a velocity along the cable would be removed by step 6 before the
// damping could be seen at all.
//
// The expected velocity is the seven steps as the specification writes them,
// applied to the state the build itself reports the tick began at. The
// undamped vector — the same steps with the factor left out — is computed
// alongside it, so the failure message says how far apart the two answers stand.

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

/** The speed posed along the tangent: a brisk swing, well clear of rounding. */
const SPEED = 2;

/** Arithmetic slack on a velocity the seven steps fix exactly. */
const TOLERANCE = 1e-9;

const DT = 1 / TICK_HZ;

/** Steps 1 to 7's velocity, with step 6's damping factor given as `damping`. */
function pendulumTick(
  p: Vec3,
  v: Vec3,
  pivotPrev: Vec3,
  pivot: Vec3,
  damping: number,
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
  return {
    x: vP.x + (relative.x - radial * n.x) * damping,
    y: vP.y + (relative.y - radial * n.y) * damping,
    z: vP.z + (relative.z - radial * n.z) * damping,
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("damps the swing by 1 - SWING_DAMPING * dt over a tick", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, HOLD_TAPE);
  await startRun(h);
  const settled = (await runTicks(h, 1)).run;

  // On the sphere, forty-five degrees off the vertical, swinging along the
  // tangent there: the cable's direction is (1, -1, 0) / sqrt(2) and the
  // tangent in that plane is (1, 1, 0) / sqrt(2).
  const half = Math.SQRT1_2;
  const L = settled.axes.hoist.value;
  await h.debug.setBob(
    settled.pivot.x + L * half,
    settled.pivot.y - L * half,
    settled.pivot.z,
  );
  await h.debug.setBobVelocity(SPEED * half, SPEED * half, 0);
  const before = (await h.snapshot()).run;
  const after = (await runTicks(h, 1)).run;

  await h.capture("swing", "The damped swing over the tick read");

  const damped = pendulumTick(
    before.bob.pos,
    before.bob.vel,
    before.pivot,
    after.pivot,
    1 - SWING_DAMPING * DT,
  );
  const undamped = pendulumTick(
    before.bob.pos,
    before.bob.vel,
    before.pivot,
    after.pivot,
    1,
  );
  const gap = Math.hypot(
    undamped.x - damped.x,
    undamped.y - damped.y,
    undamped.z - damped.z,
  );

  assertVec3Near(
    after.bob.vel,
    damped,
    TOLERANCE,
    "the velocity one tick leaves a posed swing: steps 1 to 6 multiplied by " +
      `(1 - SWING_DAMPING * dt) (specs/rigging.md), which stands ${gap.toFixed(6)} ` +
      "from what an undamped build leaves",
  );
});
