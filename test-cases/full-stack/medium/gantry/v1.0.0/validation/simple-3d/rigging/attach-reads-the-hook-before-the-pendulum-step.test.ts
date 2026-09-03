// rigging/attach-reads-the-hook-before-the-pendulum-step — the candidate search
// measures from the bob as it stands at the TOP of the tick.
//
// specs/rigging.md § Attaching says the action "executes on a single tick" and
// specs/program.md § The tick pipeline fixes where in that tick: the tape is stage
// 1 and the rigging — "the pendulum tick, the cable tension, and the snap check" —
// is stage 4. So the hook point the candidate search measures from is the bob
// before that tick's swing, not after it, and a swinging hook that reaches a load
// during the tick has not reached it yet when the action runs.
//
// THE SCENARIO PUTS THE TWO READINGS ON OPPOSITE SIDES OF THE BOUND, which is the
// only way an ordering can be read off a distance. The load sits at the bottom of
// the swing, `(0, 2, 0)`; the bob is posed `GAP` (`0.85`) of chord away from it —
// just outside `ATTACH_RADIUS` (`0.8`) — and given `WHIP` (`8`) units a second
// along its arc toward it. One tick of the pendulum carries it to about `0.72` of
// chord, well inside the radius. So:
//
//   - measured before the swing, as the specification says, there is no candidate
//     and the run ends as `attach-missed`;
//   - measured after it, the load is comfortably in reach and the run lifts it.
//
// THE CONTROL RUN IS WHAT MAKES THE SECOND HALF OF THAT A FACT RATHER THAN A SUM.
// A failed `attach` ends the run at stage 1, so the tick under test never reaches
// its own pendulum step and the bob is left where the search read it — there is
// nothing to measure afterwards. So the same poses are driven a second time with
// the `attach` replaced by a move whose target is its axis's current value, which
// specs/program.md § Axis motion says "is done on the tick it is issued": one tick,
// nothing moved, and the pendulum free to run. That run's bob finishes the tick
// inside `ATTACH_RADIUS` of the load, which is what says the verdict under test
// came from the ORDER of the two stages and not from the load being out of reach
// all tick.
//
// `setBob` "puts the bob where it is asked for, so a caller that wants a bob the
// cable can hold sets the hoist axis to the distance it left between the pivot and
// the bob" — the posed point is exactly `HOIST_START` from the pivot, so the cable
// holds it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThan,
  assertNull,
} from "../assert";
import {
  ATTACH_RADIUS,
  GRIP_MAX_RATE,
  HOIST_START,
  SLEW_MAX_RATE,
} from "../constants";
import {
  addOneLoad,
  clearAll,
  createHarness,
  distance3,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
  type Vec3,
} from "../harness";

const SITE = 0;

/** The minimal crane's pivot at the run-start posture: the track origin. */
const PIVOT = { x: 0, y: 4, z: 0 };

/** The cable the bob swings on: the length every run starts at. */
const CABLE = HOIST_START;

/** The load waits at the bottom of the swing. */
const LOAD_AT: Vec3 = { x: PIVOT.x, y: PIVOT.y - CABLE, z: PIVOT.z };

/** The chord the bob is posed at: just outside the reach. */
const GAP = ATTACH_RADIUS + 0.05;

/** The angle off the vertical whose chord to the bottom is `GAP`. */
const ANGLE = 2 * Math.asin(GAP / (2 * CABLE));

/** The bob at that angle, one cable length from the pivot. */
const BOB: Vec3 = {
  x: PIVOT.x + CABLE * Math.sin(ANGLE),
  y: PIVOT.y - CABLE * Math.cos(ANGLE),
  z: PIVOT.z,
};

/** The speed the bob is given along its arc, toward the bottom. */
const WHIP = 8;

/** That speed as a velocity: the tangent at `ANGLE`, toward the bottom. */
const BOB_VEL: Vec3 = {
  x: -WHIP * Math.cos(ANGLE),
  y: -WHIP * Math.sin(ANGLE),
  z: 0,
};

const NOOP: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "slew", target: 0, rate: SLEW_MAX_RATE }],
};

const ATTACH: TapeStepSpec = { kind: "action", action: "attach" };

/** A move that would keep a surviving run running past the second step. */
const HOLD: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "grip", target: 100_000, rate: GRIP_MAX_RATE }],
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Pose the swinging bob just out of reach and take the tape's second step. */
async function swingIntoReach(second: TapeStepSpec): Promise<Vec3> {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(
    h,
    "crate",
    40,
    { ...LOAD_AT, yaw: 0 },
    { x: 6, y: 2, z: 0, yaw: 0 },
  );
  await poseTape(h, [NOOP, second, HOLD]);

  await startRun(h);
  await runTicks(h, 1);
  await h.debug.setBob(BOB.x, BOB.y, BOB.z);
  await h.debug.setBobVelocity(BOB_VEL.x, BOB_VEL.y, BOB_VEL.z);

  const posed = await h.snapshot();
  const gap = distance3(posed.run.bob.pos, LOAD_AT);
  assertGreaterThan(
    gap,
    ATTACH_RADIUS,
    "the hook point at the TOP of the tick the second step is taken on, " +
      `against ATTACH_RADIUS (${ATTACH_RADIUS}): the bob is posed ${GAP} of ` +
      "chord from the load",
  );

  await runTicks(h, 1);
  return (await h.snapshot()).run.bob.pos;
}

it("finds no candidate for a hook that only swings into reach mid-tick", async () => {
  // The control: the same poses with a step that lets the pendulum run, so the
  // swing that the failing run never gets to take can be measured.
  const swept = await swingIntoReach(NOOP);
  const reached = distance3(swept, LOAD_AT);
  assertLessThan(
    reached,
    ATTACH_RADIUS,
    "the hook point at the END of that same tick, against ATTACH_RADIUS " +
      `(${ATTACH_RADIUS}): the tick's pendulum step carries the bob into ` +
      "reach, so a search run after it would have found the load",
  );

  // The reading: the same tick, with the `attach` in it.
  await swingIntoReach(ATTACH);
  const missed = await h.snapshot();
  await h.capture("swing", "the hook swinging into range after the action ran");

  assertEqual(
    missed.run.phase,
    "failed",
    `the run on the tick an \`attach\` executed with the hook ${GAP} of chord ` +
      `from the load at the top of the tick and ${reached.toFixed(3)} at the ` +
      "end of it: the action executes earlier in the tick than the pendulum " +
      "step (specs/rigging.md § Attaching, specs/program.md § The tick pipeline)",
  );
  assertEqual(
    missed.run.cause,
    "attach-missed",
    "the cause an `attach` with no candidate ends the run with " +
      "(specs/rigging.md § Attaching)",
  );
  assertNull(
    missed.run.attached,
    "what the hook came away with: the load was out of reach when the search " +
      "read the hook point",
  );
});
