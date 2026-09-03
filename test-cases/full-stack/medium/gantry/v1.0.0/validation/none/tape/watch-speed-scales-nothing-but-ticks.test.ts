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
import { assertEqual } from "../assert";
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

/** Everything one tick of the pipeline produces, as one comparable string. */
function digest(s: GantrySnapshot): string {
  return JSON.stringify({
    phase: s.run.phase,
    cause: s.run.cause,
    tick: s.run.tick,
    time: s.run.time,
    stepIndex: s.run.stepIndex,
    stepLive: s.run.stepLive,
    axes: s.run.axes,
    pivot: s.run.pivot,
    bob: s.run.bob,
    attached: s.run.attached,
    loads: s.run.loads,
    forces: s.run.forces,
    broken: s.run.broken,
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
  assertEqual(
    digest(fast),
    digest(watched),
    `every figure run tick ${TICKS} produced, against the same tick of the ` +
      "same run watched at RUN_SPEEDS[0]: the speed changes how many ticks a " +
      "frame covers and nothing else (specs/program.md)",
  );
});
