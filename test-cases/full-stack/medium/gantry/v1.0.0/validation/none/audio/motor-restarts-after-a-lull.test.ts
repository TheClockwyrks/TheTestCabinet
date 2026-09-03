// audio/motor-restarts-after-a-lull — the motor loop starts again after a lull.
//
// specs/ui.md § Audio, the `motor` row: the loop "loops while a run is in progress
// and any axis's rate is nonzero, and is silent otherwise". The condition is the
// AXES, not the run: a run in progress whose every rate reads `0` is silent, and
// the next tick that moves an axis sounds again. A build that starts the loop
// when the run starts and stops it when the run ends passes every reading taken
// during motion and fails this one, and a player hears a drive running through
// every pause in the tape.
//
// A TAPE OF TWO MOVE STEPS MAKES THE LULL, and specs/program.md § The tick
// pipeline says exactly where it falls. A move step's axes "arrive during a tick's
// axis motion", and arrival sets the axis's rate to `0`; "the step is found
// complete at the top of the tick after that, which is the tick that takes the
// step following it". So the arrival tick is a tick of a running run on which
// every rate reads `0`, and the tick after it issues the second step's commands
// and moves an axis again. The lull is one tick wide, which is the sharpest form
// this requirement has.
//
// THE LULL IS FOUND RATHER THAN COUNTED. The run is driven a tick at a time and
// the first tick of a running run whose every rate is `0`, after motion has
// happened, is the lull — so the check does not depend on the controller's ramp
// arithmetic to say which tick number that is. A run that never reaches such a
// tick inside the cap fails the item, because the scenario it describes did not
// happen.
//
// BOTH READINGS OF "SOUNDING" ARE TAKEN. specs/ui.md fixes that `motor` is a loop
// and fixes nothing about how a build makes one seamless, so a source started
// with its loop flag set and a source re-scheduled end to end both count: the
// reading is the union of what is looping and what started on that tick.
//
// THE WORLD HOLDS ONLY THE CRANE. The yard is emptied, so no load and no obstacle
// can end the run or raise a cue inside the window, and the two steps drive the
// hoist, whose motion is the crane's own and reaches nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue, fail } from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type AxisName,
  type GantrySnapshot,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** Site 1, First Lift. */
const SITE = 0;

/** The four axes, as specs/program.md lists them. */
const AXES: readonly AxisName[] = ["slew", "trolley", "hoist", "grip"];

/** Two hoist moves a unit apart: one arrives, then the next takes over. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "hoist", target: HOIST_START + 1, rate: HOIST_MAX_RATE },
    ],
  },
  {
    kind: "move",
    commands: [
      { axis: "hoist", target: HOIST_START + 2, rate: HOIST_MAX_RATE },
    ],
  },
];

/** Well past the ticks the first step's ramp needs at this rate and distance. */
const CAP = 600;

/** Whether any axis is turning on the tick this snapshot reports. */
function anyAxisMoving(snapshot: GantrySnapshot): boolean {
  return AXES.some((axis) => snapshot.run.axes[axis].rate !== 0);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("falls silent on the tick every rate is zero and sounds again on the next tick that moves an axis", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);
  await h.cues();

  /** What the tick just driven left: whether it moved, and what it sounded. */
  const readTick = async (): Promise<{
    snapshot: GantrySnapshot;
    moving: boolean;
    motor: boolean;
  }> => {
    const snapshot = await runTicks(h, 1);
    const started = await h.cues();
    const looping = await h.loopingCues();
    return {
      snapshot,
      moving: anyAxisMoving(snapshot),
      motor: started.includes("motor") || looping.includes("motor"),
    };
  };

  let sawMotion = false;
  let lull: Awaited<ReturnType<typeof readTick>> | null = null;
  for (let i = 0; i < CAP && lull === null; i += 1) {
    const tick = await readTick();
    if (tick.snapshot.run.phase !== "running") {
      fail(
        "a run still in progress while the first step's axes arrive " +
          "(specs/program.md § The tick pipeline)",
        `the run ended on tick ${tick.snapshot.run.tick} as ` +
          `"${tick.snapshot.run.phase}"` +
          (tick.snapshot.run.cause === null
            ? ""
            : ` (${tick.snapshot.run.cause})`),
      );
    }
    if (tick.moving) {
      sawMotion = true;
      continue;
    }
    if (sawMotion) lull = tick;
  }
  if (lull === null) {
    fail(
      `a tick of the running run on which every axis's rate reads 0, within ` +
        `${CAP} ticks: the first move step's axes arrive and stop before the ` +
        "tick after it takes the second step (specs/program.md § The tick " +
        "pipeline)",
      "the axes never all stopped",
    );
  }

  const next = await readTick();
  await h.capture("motor", "The lull between two move steps");

  assertTrue(
    !lull.motor,
    `the motor loop on tick ${lull.snapshot.run.tick}, the tick the first ` +
      "step's axes arrived and every rate read 0: the loop \"loops while a " +
      "run is in progress and any axis's rate is nonzero, and is silent " +
      'otherwise" (specs/ui.md § Audio), and the run was still in progress ' +
      "with a step left to take, so only the rates can have silenced it",
  );
  assertEqual(
    next.snapshot.run.phase,
    "running",
    `the run on tick ${next.snapshot.run.tick}, the tick after the lull`,
  );
  assertTrue(
    next.moving,
    `an axis turning on tick ${next.snapshot.run.tick}, the tick the second ` +
      "move step is taken and issues its commands (specs/program.md § The " +
      "tick pipeline)",
  );
  assertTrue(
    next.motor,
    `the motor loop on tick ${next.snapshot.run.tick}, the first tick after ` +
      "the lull to move an axis: the loop follows the axes and not the run's " +
      "phase, so it sounds again the moment a rate is nonzero (specs/ui.md § " +
      "Audio, the `motor` row)",
  );
});
