// clock/fixed-tick-division — a span of game time reaches the same state
// however it is divided into frames.
//
// WHERE THE THRESHOLD COMES FROM. specs/instrumentation.md ("A deterministic
// core"): "On `playing`, each frame's delta time joins the accumulator, every
// whole `TICK_DT` in it is consumed as a tick, and the remainder waits for the
// next frame. A tick is consumed while the accumulator is at least
// `TICK_DT − TICK_EPSILON` ... so a frame of `0.5` seconds runs exactly `30`
// ticks and sixty frames of `1 / 60` seconds run exactly `60`. ... An interval
// of game time on `playing` therefore reaches the same state however it was
// divided into frames, and drawing advances nothing." And of `step`: "On
// `playing` the update is one whole tick of `specs/world.md`, run directly
// rather than through the accumulator", each frame "exactly a frame of the
// loop". The same file fixes what "the same state" is: "Given the same seed,
// the same sequence of operations, and the same number of ticks, the game
// reaches the same `run` and `rngState` every time."
//
// THE THREE DIVISIONS. The same half second three ways, each from the same
// posed night under the same seed: one frame of `0.5` s through `advance`;
// fifty frames of `0.01` s through `advance`, which the epsilon rule makes
// consume the thirtieth tick on the fiftieth frame, since forty-nine of them
// sum to `0.49` and thirty ticks need `0.5 − 1e-9`; and thirty frames of one
// tick each through `step`, which is the division that bypasses the
// accumulator altogether. Each leaves `run.tick` thirty higher, and the three
// `run` objects and three `rngState` values are equal.
//
// THE NIGHT. `poseLiveNight`, with the spawn director's timer on beside it: a
// moth walking, a bolt flying, a puddle and a contact cooldown counting, a gem
// in flight, Taper's timer counting, and a spawn on the first tick that draws
// from the seeded generator, so `rngState` moves and a build whose draws
// depended on the frame rather than the tick would show in it. The three
// poses are compared to each other before the drives, so a pose that itself
// differed fails here for what it is.
//
// THE TOLERANCE. None. A whole tick is the same computation on the same
// state whichever frame consumed it, so a conformant build lands on identical
// numbers; the comparison is `assertDeepEqual` over `run`, and `===` on
// `rngState`. What this excludes is a build that integrates with the frame's
// delta rather than the tick's: `0.5` s in one step, fifty steps, and thirty
// steps land a moving moth on three different positions.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { TICK_HZ } from "../constants";
import {
  advanceBy,
  captureReplay,
  createHarness,
  type Harness,
  type WickSnapshot,
} from "../harness";
import { LIVE_FACULTIES, poseLiveNight } from "./stage";

/** The span every division covers, in seconds. */
const SPAN = 0.5;

/** The ticks that span is: `0.5 × TICK_HZ`. */
const TICKS = SPAN * TICK_HZ;

/** The small frame of the second division, and how many of them make the span. */
const SMALL_FRAME = 0.01;
const SMALL_FRAMES = SPAN / SMALL_FRAME;

/** One division: the night as posed, and the state its drive left. */
interface Division {
  before: WickSnapshot;
  after: WickSnapshot;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Pose the live night afresh, run `drive` over it, and read both ends. */
async function divide(drive: () => Promise<unknown>): Promise<Division> {
  const before = await poseLiveNight(h, {
    on: [...LIVE_FACULTIES, "spawning"],
  });
  await drive();
  const after = await h.snapshot();
  return { before, after };
}

it("reaches the same state from one frame, fifty small frames, and thirty ticks", async () => {
  const whole = await divide(() => advanceBy(h, SPAN));
  const small = await divide(async () => {
    for (let i = 0; i < SMALL_FRAMES; i += 1) await advanceBy(h, SMALL_FRAME);
  });
  const ticked = await captureReplay(h, "divided", () =>
    divide(() => h.step(TICKS)),
  );

  // The three nights were the same night before anything ran.
  assertDeepEqual(
    small.before.run,
    whole.before.run,
    "the posed run before the fifty small frames, against the one-frame pose",
  );
  assertDeepEqual(
    ticked.before.run,
    whole.before.run,
    "the posed run before the thirty ticks, against the one-frame pose",
  );

  assertEqual(
    whole.after.run.tick,
    whole.before.run.tick + TICKS,
    "run.tick after one frame of 0.5 s",
  );
  assertEqual(
    small.after.run.tick,
    small.before.run.tick + TICKS,
    "run.tick after fifty frames of 0.01 s",
  );
  assertEqual(
    ticked.after.run.tick,
    ticked.before.run.tick + TICKS,
    "run.tick after thirty frames of one tick",
  );

  assertDeepEqual(
    small.after.run,
    whole.after.run,
    "the run after fifty frames of 0.01 s, against one frame of 0.5 s",
  );
  assertEqual(
    small.after.rngState,
    whole.after.rngState,
    "rngState after fifty frames of 0.01 s, against one frame of 0.5 s",
  );
  assertDeepEqual(
    ticked.after.run,
    whole.after.run,
    "the run after thirty frames of one tick, against one frame of 0.5 s",
  );
  assertEqual(
    ticked.after.rngState,
    whole.after.rngState,
    "rngState after thirty frames of one tick, against one frame of 0.5 s",
  );
});
