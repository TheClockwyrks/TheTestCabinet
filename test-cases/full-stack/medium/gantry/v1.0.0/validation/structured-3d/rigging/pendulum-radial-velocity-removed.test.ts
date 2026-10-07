// rigging/pendulum-radial-velocity-removed — after a tick the bob's velocity
// relative to the pivot has no component along the cable.
//
// `specs/rigging.md` § The pendulum tick, step 6: "`vr = v - vP`, then remove the
// radial part, `vr = vr - dot(vr, n) * n`". A cable cannot push or pull the bob
// along itself and leave it moving that way, so whatever the tick began with, the
// velocity it ends with is tangential to the sphere. Step 4 places the bob at
// `P + L * n`, so the direction the reading takes the component along is the one
// the tick's own answer gives: `(p - P)` normalized, read after the tick.
//
// THE BOB IS POSED WITH A VELOCITY PURELY ALONG THE CABLE, at forty-five degrees
// off the vertical so the direction is a genuine three-component one rather than
// straight down, where a build that removed nothing could still look right by
// accident. One unit a second along the cable is what step 6 has to take away: a
// build that skips the removal leaves `-1.17` of radial velocity where this
// reading allows `1e-9`.
//
// THE PIVOT STANDS STILL, so `vP` is zero and the bob's velocity is already its
// velocity relative to the pivot; it is read from the run rather than assumed.
// Nothing here rests on how a posed velocity is carried into the acceleration: the
// reading is of the velocity the tick leaves, which step 6 alone decides.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { GRIP_MAX_RATE, TICK_HZ } from "../constants";
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

/** The speed posed along the cable, outward from the pivot. */
const SPEED = 1;

/** Arithmetic slack on a component the seven steps drive to exactly zero. */
const TOLERANCE = 1e-9;

const DT = 1 / TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves no velocity along the cable after a tick", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, HOLD_TAPE);
  await startRun(h);
  const settled = (await runTicks(h, 1)).run;

  // On the sphere at forty-five degrees off the vertical, moving straight out
  // along the cable: the direction (1, -1, 0) / sqrt(2) from the pivot.
  const half = Math.SQRT1_2;
  const L = settled.axes.hoist.value;
  await h.debug.setBob(
    settled.pivot.x + L * half,
    settled.pivot.y - L * half,
    settled.pivot.z,
  );
  await h.debug.setBobVelocity(SPEED * half, -SPEED * half, 0);
  const before = (await h.snapshot()).run;
  const after = (await runTicks(h, 1)).run;

  await h.capture("state", "The driven state this point decides");

  // The tick's own cable direction, and the pivot's own velocity over it.
  const away = {
    x: after.bob.pos.x - after.pivot.x,
    y: after.bob.pos.y - after.pivot.y,
    z: after.bob.pos.z - after.pivot.z,
  };
  const span = Math.hypot(away.x, away.y, away.z);
  const n = { x: away.x / span, y: away.y / span, z: away.z / span };
  const vP = {
    x: (after.pivot.x - before.pivot.x) / DT,
    y: (after.pivot.y - before.pivot.y) / DT,
    z: (after.pivot.z - before.pivot.z) / DT,
  };
  const relative = {
    x: after.bob.vel.x - vP.x,
    y: after.bob.vel.y - vP.y,
    z: after.bob.vel.z - vP.z,
  };

  assertNear(
    relative.x * n.x + relative.y * n.y + relative.z * n.z,
    0,
    TOLERANCE,
    "the bob's velocity relative to the pivot, along the cable, after one " +
      `tick of a posed ${SPEED} a second straight out along it ` +
      "(specs/rigging.md)",
  );
});
