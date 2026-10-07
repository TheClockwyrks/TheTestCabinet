// rigging/pendulum-first-tick-pivot-prev — on a run's first tick the previous
// pivot is the one the run started at, so a first tick that moves the pivot
// carries a pivot velocity like any other.
//
// `specs/rigging.md` § The pendulum tick: "On a run's first tick, `P_prev` is the
// pivot at the run's starting posture (`specs/program.md`)." `specs/state.md`
// says what that posture leaves — "The pivot | the trolley point that posture puts
// under the cable" — and the snapshot reports it from the start until the first
// tick, so the reading below takes `P_prev` from the run BEFORE the tick and `P`
// from the run after it, exactly as step 5 asks.
//
// THE PIVOT IS MOVED A LONG WAY ON THAT VERY TICK. `setAxis("trolley", value)`
// "sets an axis's value, leaving it stopped with no live command"
// (`specs/instrumentation.md`), so posing the trolley one unit out before the
// first tick has the tick's geometry stand the pivot a unit from where the run
// started. Step 5 then reads `vP = (P - P_prev) / dt` as `60` units a second and
// steps 6 and 7 hand most of it to the bob: the tick ends with the bob moving at
// about `27` a second. A build that seeded `P_prev` with the tick's OWN pivot
// reads `vP` as zero and leaves the bob almost exactly at rest, which is the gap
// the failure message reports.
//
// A ONE-UNIT POSE RATHER THAN A DRIVEN TROLLEY, because the driven axis covers
// `0.001` on the tick it is issued and the two readings would then differ in the
// fifth decimal instead of the first. The pose is a precondition like any other:
// "none of them reaches a verdict: the run's own rules decide clearing, breakage,
// and every failure on the ticks that follow."
//
// The world holds the crane and nothing else, and the expected velocity is the
// seven steps as the specification writes them over the state the build itself
// reports.

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

/** Where the trolley is posed before the first tick: a unit along the track. */
const ALONG = 1;

/** Arithmetic slack on a velocity the seven steps fix exactly. */
const TOLERANCE = 1e-9;

const DT = 1 / TICK_HZ;

/** The velocity steps 1 to 7 of `specs/rigging.md` leave. */
function pendulumVelocity(
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

it("takes the run-start pivot as the previous pivot on the first tick", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, HOLD_TAPE);
  await startRun(h);

  await h.debug.setAxis("trolley", ALONG);
  const before = (await h.snapshot()).run;
  const after = (await runTicks(h, 1)).run;

  await h.capture("first", "The first tick with the trolley already driving");

  const expected = pendulumVelocity(
    before.bob.pos,
    before.bob.vel,
    before.pivot,
    after.pivot,
  );
  const seeded = pendulumVelocity(
    before.bob.pos,
    before.bob.vel,
    after.pivot,
    after.pivot,
  );
  const gap = Math.hypot(
    expected.x - seeded.x,
    expected.y - seeded.y,
    expected.z - seeded.z,
  );

  assertVec3Near(
    after.bob.vel,
    expected,
    TOLERANCE,
    "the velocity the run's first tick leaves, taken against the run-start " +
      "pivot as P_prev (specs/rigging.md); a build seeding P_prev with the " +
      `tick's own pivot leaves a velocity ${gap.toFixed(3)} away`,
  );
});
