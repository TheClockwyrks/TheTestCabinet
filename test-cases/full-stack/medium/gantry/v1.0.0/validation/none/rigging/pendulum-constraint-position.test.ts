// rigging/pendulum-constraint-position — step 4 puts the bob back on the sphere,
// along the direction step 3 read.
//
// `specs/rigging.md` § The pendulum tick, steps 2 to 4: "Drift: `p = p + v * dt`",
// "Constraint direction: `n = (p - P) / |p - P|`", "Constraint position:
// `p = P + L * n`". So the tick's own arithmetic fixes exactly where a bob that
// stood off the sphere ends up: on the ray from the pivot through the drifted
// point, at the cable's length along it. That is the position asserted below,
// computed from the state the build itself reports the tick began at — the bob's
// posed position, the velocity the previous tick left, the tick's pivot, and the
// tick's cable length — so every step is checked against the figures the
// specification gives rather than against a reference's answer.
//
// THE BOB IS POSED WELL OFF THE SPHERE, at `5.39` from the pivot against the `2`
// the cable allows. That is what separates this from the length alone: a build
// that pulled the bob to the right distance along the WRONG direction — straight
// down, say, as a build that read `n` before drifting would — passes
// `cable-is-inextensible` and fails here by more than a unit.
//
// ONLY THE POSITION IS POSED. The velocity is left where the previous tick left
// it, which is zero for a bob hanging at rest, so nothing here depends on how a
// posed velocity is carried into a tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertVec3Near } from "../assert";
import { GRAVITY, GRIP_MAX_RATE, TICK_HZ } from "../constants";
import {
  createHarness,
  emptyYard,
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

/** Far off the sphere the cable allows, and clear of the ground. */
const OFF_THE_SPHERE = { x: 3, y: 8, z: -2 };

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

it("places the bob at the pivot plus L along the drifted direction", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, HOLD_TAPE);
  await startRun(h);
  await runTicks(h, 1);

  await h.debug.setBob(OFF_THE_SPHERE.x, OFF_THE_SPHERE.y, OFF_THE_SPHERE.z);
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
    "the bob after one tick: the pivot plus L along the direction of the " +
      `drifted position, ${span.toFixed(3)} away before the constraint ` +
      "(specs/rigging.md)",
  );
});
