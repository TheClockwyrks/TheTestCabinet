// instrumentation/auto-step-off-stops-the-frame-loop — taken off real time, the
// game changes only when it is advanced.
//
// `specs/instrumentation.md` § The clock: "`setAutoStep(false)` stops the frame
// loop advancing the game from the wall clock, so it changes only when `advance`
// says so." Everything the surface is for rests on it — "Advancing while the
// game is still stepping automatically adds to what the wall clock is already
// doing, so a scenario that counts ticks calls `setAutoStep(false)` first" —
// and every check in this project is driven with the game already taken off its
// own clock, which is the state this one measures.
//
// A RUN IN PROGRESS IS THE HARDEST THING TO HOLD STILL. An idle build screen has
// little to move; a run is a pipeline the frame loop drives every tick
// (`specs/program.md`), so the check starts one and drives it ten ticks, leaving
// an axis mid-command and moving. Then it runs THIRTY OF THE BUILD'S OWN FRAMES
// — the frames the build asked the page for, each handed the timestamp a real
// loop would have handed it, `1 / TICK_HZ` of a second apart, so half a second of
// a loop's clock passes inside them — with no `advance` call at all. A build
// still stepping from its frame loop steps thirty ticks there, and its run's own
// tick counter and its four axis values would all move. Nothing may.
//
// WHY THE FRAMES ARE RUN RATHER THAN WAITED FOR. What a build does in a frame is
// the requirement; how long a host takes to deliver one is not. Waiting out real
// seconds would make this a different check on a fast machine and a slow one,
// and would decide nothing a build could not pass by being slow. So the frames
// are driven, and each is the frame the page would have run.
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
  createHarness,
  emptyYard,
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

/** Ticks driven before the held frames, so an axis is moving through them. */
const WARMUP = 10;

/** Frames of the build's own loop run with no advance: half a second at TICK_HZ. */
const HELD_FRAMES = TICK_HZ / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves a run standing still across the frames its own loop asked for", async () => {
  await openSite(h, 0);
  // The yard is emptied and nothing else is. A site opened after a reset
  // carries an empty structure and an empty tape (specs/state.md), and the
  // crane and the tape below are posed onto them; clearing either again would
  // drive surface this requirement does not concern.
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, HOLD_TAPE);
  await startRun(h);

  const before = await runTicks(h, WARMUP);
  assertEqual(before.run.tick, WARMUP, "the ticks the warm-up drove");
  assertGreaterThan(
    Math.abs(before.run.axes.grip.rate),
    0,
    "the grip's rate when the held frames begin, so an axis is genuinely " +
      "moving and a frame that stepped the game would show in its value",
  );

  await h.paintFrames(HELD_FRAMES);
  const after = await h.snapshot();

  await h.capture(
    "still",
    "The run after thirty frames of the build's own loop",
  );

  assertEqual(
    after.run.tick,
    before.run.tick,
    `run.tick across ${HELD_FRAMES} frames of the build's own loop, which ` +
      "carry half a second of the clock a loop is driven on " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    JSON.stringify(after.run.axes),
    JSON.stringify(before.run.axes),
    `the four axes across ${HELD_FRAMES} frames of the build's own loop ` +
      "(specs/instrumentation.md)",
  );
});
