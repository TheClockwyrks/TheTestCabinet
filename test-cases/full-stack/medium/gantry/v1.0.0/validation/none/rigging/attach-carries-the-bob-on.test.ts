// rigging/attach-carries-the-bob-on — an attach changes the bob's mass and
// nothing else about it.
//
// specs/rigging.md § Attaching: with a candidate, "the bob's mass includes the
// load's from this tick's pendulum step on ... and the bob's position and velocity
// carry on unchanged." The pendulum tick in the same file reads no mass at any of
// its seven steps, so a swinging hook must swing on through a lift exactly as it
// would have with nothing on it: no jolt, no snap to the load's position, no
// velocity shed to the mass it just picked up.
//
// THE CONTROL IS THE SAME RUN WITH THE ACTION TAKEN OUT. Both runs are posed
// identically — the same crane, the same yard, the same bob — and their tapes
// differ in one step and one step only: where one takes the `attach`, the other
// takes a move whose target is its axis's current value, which specs/program.md §
// Axis motion says "is done on the tick it is issued". That is one tick either
// way, so the two runs stay in lock step and every tick of one lines up with the
// same tick of the other. The bob's path is then compared tick for tick across the
// lift and the two seconds that follow it.
//
// THE BOB IS POSED SWINGING, because a bob hanging still would carry on unchanged
// whatever a build did to its velocity. `setBob` "puts the bob where it is asked
// for, so a caller that wants a bob the cable can hold sets the hoist axis to the
// distance it left between the pivot and the bob" (specs/instrumentation.md): the
// hoist is posed to `HOIST_MIN` (`1`) and the bob to a point exactly one unit from
// the pivot and `36.9` degrees off the vertical, so the cable holds it and it
// swings. The short cable is what keeps the carried crate clear of the ground —
// its lift point never falls below `y = 3`, and a crate is `2` tall — so nothing
// in specs/statics.md § Collisions can end either run and change the comparison
// into a comparison of two stopped ones.
//
// The load waits at the bob's posed position, so it is a candidate the moment the
// action runs and the lift is certain.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { GRIP_MAX_RATE, HOIST_MIN, SLEW_MAX_RATE } from "../constants";
import {
  addOneLoad,
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type GantrySnapshot,
  type Harness,
  type TapeStepSpec,
  type Vec3,
} from "../harness";

const SITE = 0;

/** The minimal crane's pivot at the run-start posture: the track origin. */
const PIVOT = { x: 0, y: 4, z: 0 };

/** The cable length the runs swing on: the shortest the hoist reaches. */
const CABLE = HOIST_MIN;

/** The bob, one cable length from the pivot and well off the vertical. */
const BOB: Vec3 = { x: 0.6 * CABLE, y: PIVOT.y - 0.8 * CABLE, z: 0 };

/** Ticks of swing compared, from the lift's own tick onward: two seconds. */
const WATCHED = 120;

/**
 * How close two swings of the same pendulum have to come.
 *
 * The pendulum tick reads no mass, so the two runs integrate the same seven
 * steps from the same state and should not differ at all; a swing that shed or
 * gained velocity at the lift diverges by whole units within a few ticks.
 */
const TOLERANCE = 1e-9;

const NOOP: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "slew", target: 0, rate: SLEW_MAX_RATE }],
};

const ATTACH: TapeStepSpec = { kind: "action", action: "attach" };

/** A move that keeps a run running and moves neither pivot nor cable. */
const HOLD: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "grip", target: 100_000, rate: GRIP_MAX_RATE }],
};

/** One tick's reading of the bob. */
interface BobSample {
  pos: Vec3;
  vel: Vec3;
}

function bobOf(snapshot: GantrySnapshot): BobSample {
  return { pos: snapshot.run.bob.pos, vel: snapshot.run.bob.vel };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * Pose the swinging bob and run `WATCHED` ticks, answering the bob each tick.
 *
 * The tape's second step is the variable: the `attach` in one run, a move that
 * takes one tick and changes nothing in the other.
 */
async function swing(second: TapeStepSpec): Promise<BobSample[]> {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(
    h,
    "crate",
    40,
    { ...BOB, yaw: 0 },
    { x: 6, y: 2, z: 0, yaw: 0 },
  );
  await poseTape(h, [NOOP, second, HOLD]);

  await startRun(h);
  await runTicks(h, 1);
  await h.debug.setAxis("hoist", CABLE);
  await h.debug.setBob(BOB.x, BOB.y, BOB.z);
  await h.debug.setBobVelocity(0, 0, 0);

  const path: BobSample[] = [];
  for (let tick = 0; tick < WATCHED; tick += 1) {
    path.push(bobOf(await runTicks(h, 1)));
  }
  return path;
}

it("carries the bob's position and velocity on unchanged through a lift", async () => {
  const lifted = await swing(ATTACH);
  const attached = await h.snapshot();
  await h.capture("attach", "the bob's path across the attach");
  assertEqual(
    attached.run.attached,
    0,
    "the load the run under test lifted on its second step",
  );
  assertEqual(
    attached.run.phase,
    "running",
    `the run under test after ${WATCHED} ticks of swing`,
  );

  const control = await swing(NOOP);
  const unloaded = await h.snapshot();
  assertEqual(
    unloaded.run.attached,
    null,
    "the load the control run lifted: it has no `attach` step",
  );
  assertEqual(
    unloaded.run.phase,
    "running",
    `the control run after ${WATCHED} ticks of swing`,
  );

  for (const [tick, sample] of lifted.entries()) {
    const same = control[tick] as BobSample;
    for (const axis of ["x", "y", "z"] as const) {
      assertNear(
        sample.pos[axis],
        same.pos[axis],
        TOLERANCE,
        `the bob's ${axis} on tick ${tick + 2} of the run that lifted a load ` +
          "on tick 2, against the same tick of the run that lifted nothing: " +
          '"the bob\'s position and velocity carry on unchanged" ' +
          "(specs/rigging.md § Attaching)",
      );
      assertNear(
        sample.vel[axis],
        same.vel[axis],
        TOLERANCE,
        `the bob's ${axis} velocity on tick ${tick + 2} of the run that ` +
          "lifted a load on tick 2, against the same tick of the run that " +
          "lifted nothing (specs/rigging.md § Attaching)",
      );
    }
  }
});
