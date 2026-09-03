// tape/run-accumulator-empty-at-start — the tick accumulation belongs to the run
// and is empty when one starts.
//
// `specs/overview.md` § Units, ticks, and the stage: "each frame's delta time
// accumulates, whole ticks are consumed from the accumulation, and a remainder
// shorter than a tick waits for the next frame. The accumulation belongs to the
// run: it is empty when a run starts, so no time measured on the menus, in the
// editor, or by an earlier run is carried into it."
//
// THE DEFECT THE CHECK IS SHAPED AROUND is one accumulator fed by every frame
// whatever the screen and drained only while a run is on. Such a build spends
// five seconds in the editor, starts a run, and the run's first frame consumes
// every tick that time bought: `run.tick` jumps to three hundred and one instead
// of one, and a tape written for a crane plays out instantly.
//
// SO THE EDITOR IS DRIVEN FIRST, AND HARD. Three hundred frames pass on the build
// screen — five seconds of simulated time, which `simTime` is read back to
// confirm actually elapsed — before a single thing about the run is arranged. Then
// the run starts and exactly one frame is driven, and the run's clock is read.
// `specs/state.md` fixes both readings: `0` at the start, since "a start takes no
// tick of its own, and carries no earlier time into the run", and "the run's first
// tick is the first tick the frame loop takes after the start, numbered `1`".
//
// The crane and the tape are the smallest a run legally starts on, and the yard is
// emptied: nothing here concerns a load.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** One hoist move, long enough that the run is still going after a tick. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "hoist", target: HOIST_START + 2, rate: HOIST_MAX_RATE },
    ],
  },
];

/** Frames spent in the editor before the run: five seconds' worth. */
const EDITOR_FRAMES = 300;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries no editor time into the run's clock", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);

  const idle = (await h.snapshot()).simTime;
  await h.advance(EDITOR_FRAMES);
  const spent = (await h.snapshot()).simTime;
  assertGreaterThan(
    spent,
    idle,
    "the simulation time the editor's frames accumulated (specs/state.md), " +
      "which is the time a run must not inherit",
  );

  const started = await startRun(h);
  assertEqual(
    started.run.tick,
    0,
    "run.tick immediately after the start, however much time was spent " +
      "before it (specs/state.md)",
  );

  await h.advance(1);
  const first = await h.snapshot();
  await h.capture("state", "The driven state this point decides");

  assertEqual(
    first.run.tick,
    1,
    "run.tick after exactly one frame of the run: the accumulation a run " +
      "starts with is empty (specs/overview.md)",
  );
});
