// tape/watch-speed-scales-nothing-but-ticks — the watch speed changes how many
// ticks a frame covers and nothing else.
//
// `specs/program.md` § Starting and ending a run: "The player watches at any of
// `RUN_SPEEDS` (`1`, `2`, `4`) times real time; speed changes how many ticks a
// second of watching covers and nothing else."
// `specs/instrumentation.md` says the same of a driven frame: "The watch speed
// scales what a frame covers exactly as it scales a real frame." So the run is
// one sequence of ticks, and the speed decides only how many of them a frame
// takes — never what any of them does.
//
// THE SAME RUN IS WATCHED TWICE, EIGHT TICKS DEEP. Once at speed index `0`
// (`RUN_SPEEDS[0]`, `1`), where eight frames are eight ticks, and once at speed
// index `2` (`RUN_SPEEDS[2]`, `4`), where two frames are the same eight. Both
// readings are taken at run tick `8`, and every figure a tick produces is
// compared: the tape position, the four axes, the pivot, the bob, the loads, the
// solved forces and the broken list. The speed index itself is left out of the
// comparison, since that is the one thing the two runs differ in.
//
// The discrete figures — the phase, the tape position, the attached load, each
// load's phase and the broken list — are compared exactly, since the specs
// state them exactly. The figures the simulation integrates — the axes, the
// pivot, the bob, the loads' poses and the solved forces — are compared within
// `TOLERANCE`, the same `1e-9` the rigging suites read a bob's path at, which
// is far below anything a tick could move and leaves the comparison to what
// the run did rather than to how a build rounds.
//
// THE TAPE OUTLIVES THE READING, so both runs are compared while the simulation
// is live rather than after it stopped: a forty-five degree slew at
// `SLEW_MAX_RATE` takes some seconds, and eight ticks is an eighth of one.
//
// The second run is started fresh from the same structure and the same tape —
// `abortRun` "poses the abort, ending a running run with no verdict" and puts the
// run back to its idle placeholder — so what is compared is two runs from the
// same start rather than one run continued.
//
// The yard is emptied and the crane is the minimal one: the requirement is about
// the watch speed, and nothing else belongs in the world it is read in.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertVec3Near } from "../assert";
import { RUN_SPEEDS, SLEW_MAX_RATE } from "../constants";
import {
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
} from "../harness";

/** One slew move, gentle and long: still live at the tick both runs are read at. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "slew", target: 45, rate: SLEW_MAX_RATE }],
  },
];

/** The tick both runs are compared at. */
const TICKS = 8;

/** The faster watch: `RUN_SPEEDS[2]` is `4`, so two frames cover the eight ticks. */
const FAST = 2;

/** How far apart two readings of an integrated figure may sit and still agree. */
const TOLERANCE = 1e-9;

/** The figures the specs state exactly, as one comparable string. */
function discrete(s: GantrySnapshot): string {
  return JSON.stringify({
    phase: s.run.phase,
    cause: s.run.cause,
    tick: s.run.tick,
    stepIndex: s.run.stepIndex,
    stepLive: s.run.stepLive,
    attached: s.run.attached,
    loadPhases: s.run.loads.map((l) => l.phase),
    forceIds: s.run.forces.map((f) => f.id),
    broken: s.run.broken,
  });
}

/**
 * Every figure the simulation integrates, read from `fast` against the same
 * figure of `slow`, within `TOLERANCE`.
 */
function assertIntegratedAgree(
  fast: GantrySnapshot,
  slow: GantrySnapshot,
  why: string,
): void {
  assertNear(fast.run.time, slow.run.time, TOLERANCE, `run.time (${why})`);
  for (const axis of ["slew", "trolley", "hoist", "grip"] as const) {
    const a = fast.run.axes[axis];
    const b = slow.run.axes[axis];
    assertNear(a.value, b.value, TOLERANCE, `run.axes.${axis}.value (${why})`);
    assertNear(a.rate, b.rate, TOLERANCE, `run.axes.${axis}.rate (${why})`);
    assertEqual(
      a.command === null,
      b.command === null,
      `whether a command is live on run.axes.${axis} (${why})`,
    );
    if (a.command !== null && b.command !== null) {
      assertNear(
        a.command.target,
        b.command.target,
        TOLERANCE,
        `run.axes.${axis}.command.target (${why})`,
      );
      assertNear(
        a.command.rate,
        b.command.rate,
        TOLERANCE,
        `run.axes.${axis}.command.rate (${why})`,
      );
    }
  }
  assertVec3Near(
    fast.run.pivot,
    slow.run.pivot,
    TOLERANCE,
    `run.pivot (${why})`,
  );
  assertVec3Near(
    fast.run.bob.pos,
    slow.run.bob.pos,
    TOLERANCE,
    `run.bob.pos (${why})`,
  );
  assertVec3Near(
    fast.run.bob.vel,
    slow.run.bob.vel,
    TOLERANCE,
    `run.bob.vel (${why})`,
  );
  slow.run.loads.forEach((load, i) => {
    const other = fast.run.loads[i];
    assertVec3Near(
      other.pos,
      load.pos,
      TOLERANCE,
      `run.loads[${i}].pos (${why})`,
    );
    assertNear(other.yaw, load.yaw, TOLERANCE, `run.loads[${i}].yaw (${why})`);
  });
  slow.run.forces.forEach((member, i) => {
    const other = fast.run.forces[i];
    assertNear(
      other.force,
      member.force,
      TOLERANCE,
      `run.forces[${i}].force, member ${member.id} (${why})`,
    );
    assertNear(
      other.utilization,
      member.utilization,
      TOLERANCE,
      `run.forces[${i}].utilization, member ${member.id} (${why})`,
    );
  });
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reaches the same run state at the same tick at 1x and at 4x", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);

  const slow = await startRun(h);
  assertEqual(
    slow.run.speedIndex,
    0,
    "the speed index a run starts at (specs/state.md)",
  );
  const watched = await runTicks(h, TICKS);
  assertEqual(
    watched.run.tick,
    TICKS,
    `run.tick after ${TICKS} frames at RUN_SPEEDS[0] (${RUN_SPEEDS[0]})`,
  );
  assertEqual(
    watched.run.phase,
    "running",
    "the run at the compared tick, which its tape outlives",
  );

  await h.debug.abortRun();
  await startRun(h);
  await h.debug.setSpeedIndex(FAST);
  const posed = await h.snapshot();
  assertEqual(
    posed.run.speedIndex,
    FAST,
    "the watch speed the second run is watched at",
  );

  const frames = TICKS / RUN_SPEEDS[FAST];
  const fast = await runTicks(h, frames);

  await h.capture("state", "The run at tick 8, watched at 4x");

  assertEqual(
    fast.run.tick,
    TICKS,
    `run.tick after ${frames} frames at RUN_SPEEDS[${FAST}] ` +
      `(${RUN_SPEEDS[FAST]}): a frame covers that many ticks ` +
      "(specs/program.md)",
  );
  const why =
    `run tick ${TICKS} at RUN_SPEEDS[${FAST}], against the same tick of the ` +
    "same run watched at RUN_SPEEDS[0]: the speed changes how many ticks a " +
    "frame covers and nothing else (specs/program.md)";
  assertEqual(discrete(fast), discrete(watched), `the exact figures (${why})`);
  assertIntegratedAgree(fast, watched, why);
});
