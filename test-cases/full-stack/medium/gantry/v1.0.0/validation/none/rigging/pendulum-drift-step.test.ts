// rigging/pendulum-drift-step — the position drifts by the velocity BEFORE the
// constraint direction is read off it.
//
// `specs/rigging.md` § The pendulum tick: step 2 is "Drift: `p = p + v * dt`" and
// step 3 is "Constraint direction: `n = (p - P) / |p - P|`", in that order, so
// the direction the bob is placed along is the direction of the DRIFTED point and
// not of the one the tick began at.
//
// THE BOB IS POSED ON THE SPHERE, HANGING, WITH A HORIZONTAL VELOCITY. That is
// what makes the order visible: the bob stands directly under the pivot, so a
// build that read `n` before drifting reads it as straight down and puts the bob
// back exactly where it was, while the drift carries the point `v * dt` sideways
// and the constraint swings the bob out along it. At `2` units a second the gap
// between the two answers is `0.033` units — thirty thousand times the tolerance
// below — and it is a gap in a direction, not in a length, so the cable stays
// exactly `L` long under either reading.
//
// The expected position is computed from the state the build itself reports the
// tick began at, through steps 1 to 4 as the specification writes them.

import { afterEach, beforeEach, it } from "vitest";
import { assertVec3Near } from "../assert";
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
  type Vec3,
} from "../harness";

/** A tape that keeps a run legal and asks nothing of the rigging. */
const HOLD_TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 360, rate: GRIP_MAX_RATE }],
  },
];

/** The velocity posed onto the hanging bob: horizontal, and briskly so. */
const VELOCITY = { x: 2, y: 0, z: 0 };

/** Arithmetic slack on a position the seven steps fix exactly. */
const TOLERANCE = 1e-9;

const DT = 1 / TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads the constraint direction off the drifted position", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, HOLD_TAPE);
  await startRun(h);
  await runTicks(h, 1);

  await h.debug.setBobVelocity(VELOCITY.x, VELOCITY.y, VELOCITY.z);
  const before = (await h.snapshot()).run;
  const after = (await runTicks(h, 1)).run;

  await h.capture("state", "The driven state this point decides");

  // Steps 1 to 4, on the state the tick began at.
  const p = before.bob.pos;
  const v = before.bob.vel;
  const drifted: Vec3 = {
    x: p.x + v.x * DT,
    y: p.y + (v.y - GRAVITY * DT) * DT,
    z: p.z + v.z * DT,
  };
  const P = after.pivot;
  const L = after.axes.hoist.value;
  const away: Vec3 = {
    x: drifted.x - P.x,
    y: drifted.y - P.y,
    z: drifted.z - P.z,
  };
  const span = Math.hypot(away.x, away.y, away.z);
  const expected: Vec3 = {
    x: P.x + (L * away.x) / span,
    y: P.y + (L * away.y) / span,
    z: P.z + (L * away.z) / span,
  };

  assertVec3Near(
    after.bob.pos,
    expected,
    TOLERANCE,
    "the bob after one tick of a posed horizontal velocity: the drifted " +
      "point projected onto the cable's sphere, which stands " +
      `${Math.abs(expected.x - p.x).toFixed(4)} from where a build that ` +
      "read the direction before drifting would leave it (specs/rigging.md)",
  );
});
