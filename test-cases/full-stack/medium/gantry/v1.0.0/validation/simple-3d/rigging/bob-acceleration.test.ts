// rigging/bob-acceleration — the tension carries the change in the bob's velocity
// over the tick, divided by `dt`.
//
// `specs/rigging.md` § The pendulum tick: "The bob's acceleration for the tick is
// `a = (v - v_prev) / dt`, with `v_prev` its velocity at the end of the previous
// tick." § Cable tension and snapping is where that figure goes: "`T = m * (a - g)`
// with `m` the bob's mass", and "the force the rigging applies to the structure at
// the pivot is `-T`". The structure's own member forces are therefore the reading
// that can see `a`, and this measures it against the velocities the build itself
// reports either side of one tick.
//
// THE TICK IS A FALL FROM THE HORIZONTAL, and that is what makes the reading
// sharp. The bob is posed on the sphere with the cable horizontal, at rest —
// position alone, so the velocity is the zero the previous tick left. Over the
// next tick it falls: `v` goes to about `-9.99 * dt` on `y`, so
// `a` is very nearly `(0, -GRAVITY, 0)` and `T = m * (a - g)` very nearly
// VANISHES. The cable that was hanging `HOOK_MASS * GRAVITY` (`50`) on the
// structure hangs `0.04` on it instead, and a build that carried no acceleration
// into the tension goes on hanging the full `50`.
//
// HOW A NEWTON AT THE PIVOT IS MEASURED. The trolley starts at the track origin,
// `(0, 4, 0)` on the harness's minimal crane, and the trolley's own load and the
// cable force are shared between the rail member's two nodes "linearly by its
// position along that member; at a shared node it belongs wholly to that node"
// (`specs/statics.md`), so the cable force lands on that one node. One
// counterweight placed on the SAME node applies `COUNTERWEIGHT_MASS * GRAVITY`
// (`800`) straight down there (§ The load model, at `a = 0`), and the solve is a
// linear system at a prescribed geometry, so the member forces it moves are
// exactly `800` newtons' worth of the response the cable force is measured in.
// The reading below is that calibration applied: the fall must move every member
// force by the same response scaled to the vertical newtons the tension gave up.
//
// THE HORIZONTAL PART OF THE TENSION IS WHAT THE TOLERANCE COVERS. The fall's `T`
// is not exactly vertical — the constraint leaves `0.07` newtons across the
// cable — and only the vertical response is calibrated, so the tolerance is set
// two orders above what any response to `0.07` newtons could contribute and two
// orders below the `50` the reading is about.
//
// The crane is struts and rails alone, so no cable can go slack and each solve is
// one linear system; the world holds nothing else; and the tape is one long grip
// move, the only axis whose motion moves neither the pivot nor the cable
// ("Turning the grip applies no force to anything").

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertNear } from "../assert";
import {
  COUNTERWEIGHT_MASS,
  GRAVITY,
  GRIP_MAX_RATE,
  HOOK_MASS,
  TICK_HZ,
} from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type MemberForce,
  type TapeStepSpec,
} from "../harness";

/** A tape that keeps a run legal and asks nothing of the rigging. */
const HOLD_TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 360, rate: GRIP_MAX_RATE }],
  },
];

/** The track origin of the harness's minimal crane: the trolley's own node. */
const TRACK_ORIGIN = { x: 0, y: 4, z: 0 };

/** Ticks driven before a reading, so the bob is hanging still. */
const SETTLE = 3;

/**
 * Newtons of slack. The response to the fall's `0.07` newtons across the cable
 * is not calibrated, and this stands two orders above anything it could
 * contribute and two orders below the `50` the reading is about.
 */
const TOLERANCE = 0.5;

/** The calibration has to carry real signal for the comparison to say anything. */
const MIN_SIGNAL = 100;

/** The bob must genuinely have been falling for its acceleration to be carried. */
const MIN_ACCELERATION = 1;

const DT = 1 / TICK_HZ;

/** A solve's forces, by member id. */
function byId(forces: readonly MemberForce[]): Map<number, number> {
  return new Map(forces.map((one) => [one.id, one.force]));
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the structure's forces by the tension the tick's acceleration gives", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, HOLD_TAPE);

  // The bare hook, hanging at rest: the baseline both readings are taken from.
  await startRun(h);
  const rest = (await runTicks(h, SETTLE)).run;

  // The fall: the bob posed on the sphere with the cable horizontal, at rest.
  const L = rest.axes.hoist.value;
  await h.debug.setBob(rest.pivot.x + L, rest.pivot.y, rest.pivot.z);
  const before = (await h.snapshot()).run;
  const fall = (await runTicks(h, 1)).run;

  await h.capture("accel", "The tick the bob fell from the horizontal");

  // The calibration: the same crane carrying one counterweight on the node the
  // cable force lands on, hanging at rest again.
  await h.debug.abortRun();
  await h.debug.addCounterweight(
    TRACK_ORIGIN.x,
    TRACK_ORIGIN.y,
    TRACK_ORIGIN.z,
  );
  await startRun(h);
  const weighted = (await runTicks(h, SETTLE)).run;

  // What the specification says each reading put on that node, in newtons of
  // vertical force, against the bare hook's own weight.
  const acceleration = (fall.bob.vel.y - before.bob.vel.y) / DT;
  const fallNewtons = -HOOK_MASS * acceleration;
  const weightNewtons = -COUNTERWEIGHT_MASS * GRAVITY;
  const ratio = fallNewtons / weightNewtons;

  const restForces = byId(rest.forces);
  const fallForces = byId(fall.forces);
  const weightedForces = byId(weighted.forces);

  let signal = 0;
  for (const [id, force] of weightedForces) {
    signal = Math.max(signal, Math.abs(force - (restForces.get(id) ?? 0)));
  }
  assertGreaterThan(
    Math.abs(acceleration),
    MIN_ACCELERATION,
    "the bob's acceleration over the posed tick, from the velocities the run " +
      "reports either side of it (specs/rigging.md)",
  );
  assertGreaterThan(
    signal,
    MIN_SIGNAL,
    `the largest member force the ${COUNTERWEIGHT_MASS * GRAVITY} newtons of ` +
      "counterweight moved, which is what a newton at the trolley point is " +
      "measured in (specs/statics.md)",
  );

  for (const [id, force] of restForces) {
    const weighed = (weightedForces.get(id) ?? 0) - force;
    assertNear(
      (fallForces.get(id) ?? 0) - force,
      weighed * ratio,
      TOLERANCE,
      `member ${id}: the force the falling bob moved, which is the ` +
        `${fallNewtons.toFixed(3)} newtons the tension gave up at the ` +
        "trolley point — the bob's mass times the acceleration the tick's " +
        "own velocity change gives (specs/rigging.md)",
    );
  }
});
