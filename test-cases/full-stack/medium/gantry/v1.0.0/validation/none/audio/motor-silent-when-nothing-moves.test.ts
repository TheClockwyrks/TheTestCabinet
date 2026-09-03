// audio/motor-silent-when-nothing-moves — a run standing still makes no motor
// sound.
//
// specs/ui.md § Audio: "| `motor` | loops while a run is in progress and any
// axis's rate is nonzero, and is silent otherwise …". This point is that row's
// second half, and it is the half a build misses by starting the loop with the
// run and leaving it running: a run that is between two move steps with every
// axis stopped must be silent.
//
// THE STILL WINDOW IS MADE BY THE TAPE, not by ending the run. The tape opens
// with one short `hoist` move — so the loop has genuinely been running and the
// silence is a stop rather than a start that never happened — and follows it
// with four moves whose target is the value the `slew` already stands at.
// specs/program.md makes each of those a tick that moves nothing: "A command
// whose target is the axis's current value therefore has `s` of `0`: the axis
// neither brakes nor accelerates, it does not move, and step 3 finds it arrived,
// so the command is done on the tick it is issued." A tick takes at most one
// step, so those four steps are four consecutive ticks of a run in progress with
// every axis's rate `0` — exactly the state the row calls silent. A last long
// `grip` move keeps the run from ending inside the window, so what is read is
// stillness and not a run that has stopped.
//
// THE READING TAKES BOTH HALVES OF THE BUS, because specs/assets.md leaves a
// build free to make the loop seamless by looping one source or by re-scheduling
// it end to end: the sources looping right now and the ones started since the
// last read must both be free of `motor`. The queue is drained on the first still
// tick, so the loop's own opening start, from back when the hoist was moving, is
// not what the check reads.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  GRIP_MAX_RATE,
  HOIST_MAX_RATE,
  HOIST_START,
  SLEW_MAX_RATE,
} from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  runUntil,
  standMinimalCrane,
  startRun,
  type GantrySnapshot,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The site this runs on; the motor is the run's, not the site's. */
const SITE = 0;

/** One move that moves nothing: the `slew` is already at `0` when a run starts. */
const STILL: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "slew", target: 0, rate: SLEW_MAX_RATE }],
};

/**
 * A short hoist, four still steps, and a long `grip` move.
 *
 * The hoist gets the loop running; the four still steps are the window this
 * check reads; the `grip` move keeps the run alive past it, and
 * specs/rigging.md makes it the one axis that "applies no force to anything".
 */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "hoist", target: HOIST_START + 0.2, rate: HOIST_MAX_RATE },
    ],
  },
  STILL,
  STILL,
  STILL,
  STILL,
  {
    kind: "move",
    commands: [{ axis: "grip", target: 100_000, rate: GRIP_MAX_RATE }],
  },
];

/** Well past the ticks the opening hoist takes, so the cap is a verdict. */
const MAX_TICKS = 300;

/** Whether every axis reports a rate of exactly `0` on that tick. */
function allStopped(snapshot: GantrySnapshot): boolean {
  return Object.values(snapshot.run.axes).every((axis) => axis.rate === 0);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps the motor silent while every axis's rate is zero", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);

  await startRun(h);
  await runUntil(
    h,
    (s) => s.run.stepIndex >= 1 && allStopped(s),
    MAX_TICKS,
    "the tape to reach a still step, every axis arrived and stopped " +
      "(specs/program.md)",
  );
  await h.cues(); // everything the moving hoist sounded, drained

  const still = await runTicks(h, 1);
  const sounding = [...(await h.loopingCues()), ...(await h.cues())];
  await h.capture("state", "the run standing still between two move steps");

  assertEqual(
    still.run.phase,
    "running",
    "the run while the reading is taken: this is a run in progress standing " +
      "still, not a run that has ended (specs/ui.md § Audio)",
  );
  assertEqual(
    Object.entries(still.run.axes)
      .filter(([, axis]) => axis.rate !== 0)
      .map(([name]) => name)
      .join(", "),
    "",
    "the axes with a nonzero rate on the tick the reading is taken: none, " +
      "because a command whose target is the axis's current value moves it " +
      "not at all (specs/program.md)",
  );
  assertLength(
    sounding.filter((cue) => cue === "motor"),
    0,
    "the motor sounding while every axis's rate is zero: the loop is silent " +
      "otherwise, so a run standing still between two move steps makes no " +
      "sound (specs/ui.md § Audio)",
  );
});
