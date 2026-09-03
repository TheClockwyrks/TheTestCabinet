// instrumentation/auto-step-off-stops-the-wall-clock — taken off real time, the
// game changes only when it is advanced.
//
// `specs/instrumentation.md` § The clock: "`setAutoStep(false)` stops the frame
// loop advancing the game from the wall clock, so it changes only when `advance`
// says so." Everything the surface is for rests on it — "Advancing while the
// game is still stepping automatically adds to what the wall clock is already
// doing, so a scenario that must be reproducible calls `setAutoStep(false)`
// first" — and every check in this project is driven with the game already taken
// off its own clock, which is the state this one measures.
//
// A RUN IN PROGRESS IS THE HARDEST THING TO HOLD STILL. An idle build screen has
// little to move; a run is a pipeline the frame loop drives every tick
// (`specs/program.md`), so the check starts one, drives it ten ticks so an axis
// is mid-command and moving, and then lets half a second of WALL-CLOCK time pass
// with no `advance` call at all. At sixty frames a second that is thirty frames
// a loop still reading the wall clock would have taken, and the run's own tick
// counter and its four axis values would all have moved. Nothing may.
//
// The reading is the run's tick and the four axes: the tick is what the pipeline
// increments and the axes are what the controller moves, so between them they
// catch a loop that ran a frame whether or not that frame did anything else.
//
// This decides that direction alone. That `advance` moves the game when it IS
// called is its own requirement next door.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
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

/** One grip move of a full turn: an axis under a live command throughout. */
const HOLD_TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 360, rate: GRIP_MAX_RATE }],
  },
];

/** Ticks driven before the wait, so an axis is moving when it starts. */
const WARMUP = 10;

/** Wall-clock milliseconds waited: thirty frames at TICK_HZ. */
const WAIT_MS = 500;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves a run standing still while wall-clock time passes", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, HOLD_TAPE);
  await startRun(h);

  const before = await runTicks(h, WARMUP);
  assertEqual(before.run.tick, WARMUP, "the ticks the warm-up drove");
  assertGreaterThan(
    Math.abs(before.run.axes.grip.rate),
    0,
    "the grip's rate when the wait begins, so an axis is genuinely moving " +
      "and a frame taken off the wall clock would show in its value",
  );

  await new Promise((resolve) => {
    setTimeout(resolve, WAIT_MS);
  });
  const after = await h.snapshot();

  await h.capture("still", "The run after half a second of wall clock");

  assertEqual(
    after.run.tick,
    before.run.tick,
    `run.tick across ${WAIT_MS}ms of wall clock — ` +
      `${Math.round((WAIT_MS * TICK_HZ) / 1000)} frames a loop reading the ` +
      "wall clock would have taken (specs/instrumentation.md)",
  );
  assertEqual(
    JSON.stringify(after.run.axes),
    JSON.stringify(before.run.axes),
    `the four axes across ${WAIT_MS}ms of wall clock ` +
      "(specs/instrumentation.md)",
  );
});
