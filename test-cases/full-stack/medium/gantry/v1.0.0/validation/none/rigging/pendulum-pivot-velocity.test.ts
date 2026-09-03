// rigging/pendulum-pivot-velocity — the pivot's velocity for a tick is its own
// displacement over that tick, divided by `dt`.
//
// `specs/rigging.md` § The pendulum tick, step 5: "Pivot velocity:
// `vP = (P - P_prev) / dt`". `specs/state.md` reports the pivot "at the most
// recent tick's geometry", and adds that "The pendulum reads it as the previous
// pivot on the tick after", so the two snapshots either side of one tick hand this
// reading both terms of that fraction, straight from the build.
//
// THE TROLLEY IS CRUISING AND NOTHING IS POSED. The tape drives the trolley at a
// steady `2` units a second, and by the fortieth tick the axis is past its
// acceleration and cruising (`specs/program.md`), so the tick the reading covers
// moves the pivot by `0.0333` and step 5 reads `vP` as `2` a second. Everything
// the tick began with — the bob's position, its velocity, the pivot it hung from —
// is the pendulum's own doing over the ticks before it, so what is decided here is
// step 5 on an ordinary tick rather than the arithmetic of a pose.
//
// THE ALTERNATIVE IS COMPUTED BESIDE IT: the same seven steps with `vP` left at
// zero, which is what a build that never took the pivot's motion into account
// would leave. The failure message reports how far apart the two stand, which on
// this tick is more than a unit a second against a tolerance of `1e-9`.
//
// The world holds the crane and nothing else, and the sampling stops well inside
// the trolley's move so no tick of it is the one that ends the run.

import { afterEach, beforeEach, it } from "vitest";
import { assertVec3Near } from "../assert";
import { GRAVITY, SWING_DAMPING, TICK_HZ } from "../constants";
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

/** Ticks driven before the reading: past the acceleration, inside the cruise. */
const SETTLE = 40;

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

it("carries the pivot's own displacement over the tick into the swing", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);

  const before = (await runTicks(h, SETTLE)).run;
  const after = (await runTicks(h, 1)).run;

  await h.capture("carry", "The bob carried by the cruising trolley");

  const expected = pendulumVelocity(
    before.bob.pos,
    before.bob.vel,
    before.pivot,
    after.pivot,
  );
  const still = pendulumVelocity(
    before.bob.pos,
    before.bob.vel,
    after.pivot,
    after.pivot,
  );
  const gap = Math.hypot(
    expected.x - still.x,
    expected.y - still.y,
    expected.z - still.z,
  );

  assertVec3Near(
    after.bob.vel,
    expected,
    TOLERANCE,
    "the velocity a tick of the cruising trolley leaves, with the pivot's " +
      "own velocity read as its displacement over dt (specs/rigging.md); a " +
      `build that read no pivot velocity leaves one ${gap.toFixed(3)} away`,
  );
});
