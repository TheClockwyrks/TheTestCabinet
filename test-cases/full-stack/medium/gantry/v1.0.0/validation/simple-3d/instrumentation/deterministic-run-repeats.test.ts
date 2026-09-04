// instrumentation/deterministic-run-repeats — the same structure and the same
// tape produce the same run, tick for tick.
//
// `specs/instrumentation.md` § A deterministic core: "The surface rests on the
// simulation being deterministic. Gantry uses no randomness anywhere, and a run
// advances only on its fixed tick, so the same structure and the same tape
// produce the same run, tick for tick, every time." `specs/program.md` says the
// same of the controller — "The controller is exact and deterministic: the same
// tape over the same structure produces the same motion tick for tick" — and of
// a re-run: "every run begins from the same authored state, and running is always
// repeatable".
//
// THE TWO RUNS ARE POSED THE SAME WAY, IN THE SAME SESSION. The world is cleared
// and rebuilt from the same design and the same tape before each, so the second
// run is not the first one's leftovers: a build that carried a wall-clock delta,
// a frame counter, or the ticks of the first run into the second parts from
// itself here. The first is aborted rather than watched to its end, so both are
// compared while the simulation is live — `abortRun` "poses the abort, ending a
// running run with no verdict", and puts the run back to its idle placeholder.
//
// WHAT IS COMPARED IS EVERY FIGURE A TICK PRODUCES: the phase, the tape position,
// the four axes, the pivot, the bob, the solved forces, and the broken list, read
// after every one of the `TICKS` ticks and compared at the same tick number. The
// comparison is exact, with no tolerance: determinism is bit-for-bit repetition
// of one arithmetic, not agreement within a span.
//
// The tape is one move step that drives two axes gently and outlives the drive,
// so every compared tick is a tick of live motion: the slew reaches `45` degrees
// at `10` deg/s in `4.5` seconds of run clock, far past the span compared.
// The hoist pays out one unit, which keeps the bare hook a unit clear of the
// ground — the minimal crane's pivot stands at `y = 4`, and a hook point below
// `0` would end the run as `load-struck-ground` (`specs/statics.md`) against a
// requirement that has nothing to do with the ground.
//
// THE READING IS SHORT AND IT IS TICK FOR TICK.
// The comparison is exact — two JSON strings, no tolerance — so a build that
// carried a wall-clock delta, a frame counter or the first run's ticks into the
// second parts from itself on the FIRST tick that term is non-zero, and two runs
// of a chaotic pendulum that have parted never come back together. What the
// reading has to cover is therefore the ticks over which the axes ramp, an axis
// arrives, and the bob starts swinging, not the whole tape.
//
// ONLY THE LOADS AND THE OBSTACLES ARE CLEARED between the two: a page opens a
// site with no structure and no tape stored against it, and posing the crane
// empties the structure itself, so the world each run is built into is the same
// empty yard.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { HOIST_START, TICK_HZ } from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type GantrySnapshot,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** Two thirds of a second of run clock, every tick of it compared. */
const TICKS = 40;

/**
 * One move step, gentle and long: the slew takes `4.5s` to reach `45` degrees at
 * `10` deg/s, so the step is still live at the last compared tick.
 */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "slew", target: 45, rate: 10 },
      { axis: "hoist", target: HOIST_START + 1, rate: 2 },
    ],
  },
];

/** Everything one tick of the pipeline produces, as one comparable string. */
function digest(s: GantrySnapshot): string {
  return JSON.stringify({
    phase: s.run.phase,
    cause: s.run.cause,
    tick: s.run.tick,
    stepIndex: s.run.stepIndex,
    stepLive: s.run.stepLive,
    axes: s.run.axes,
    pivot: s.run.pivot,
    bob: s.run.bob,
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

it("produces the same axes, bob and forces at every tick of a repeated run", async () => {
  /** Pose the world from scratch, run `TICKS` ticks, and answer each one. */
  const drive = async (): Promise<{ seen: string[]; last: GantrySnapshot }> => {
    await openSite(h, 0);
    await emptyYard(h);
    await standMinimalCrane(h);
    await poseTape(h, TAPE);
    let last = await startRun(h);
    const seen: string[] = [];
    for (let tick = 0; tick < TICKS; tick += 1) {
      last = await runTicks(h, 1);
      seen.push(digest(last));
    }
    return { seen, last };
  };

  const first = await drive();
  await h.debug.abortRun();
  const second = await drive();

  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  // A comparison of two runs that were over decides nothing, so the scenario
  // says what it was: at the last compared tick the run is still turning under
  // the tape, and the solve is still reporting a force for every intact member.
  assertEqual(
    first.last.run.phase,
    "running",
    `the run at tick ${TICKS}, which the tape outlives, so every compared ` +
      "tick is a tick of live simulation",
  );
  assertGreaterThan(
    first.last.run.forces.length,
    0,
    `the members the solve reports at tick ${TICKS}, so the comparison covers ` +
      "the forces as well as the motion",
  );

  for (let tick = 1; tick <= TICKS; tick += 1) {
    const clock = (tick / TICK_HZ).toFixed(3);
    assertEqual(
      second.seen[tick - 1],
      first.seen[tick - 1],
      `every figure tick ${tick} of ${TICKS} produces (${clock}s of run ` +
        "clock), across two runs of the same structure and the same tape " +
        "(specs/instrumentation.md)",
    );
  }
});
