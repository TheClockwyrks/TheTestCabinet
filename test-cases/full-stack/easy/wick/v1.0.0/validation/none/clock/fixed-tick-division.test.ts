// clock/fixed-tick-division — a span of game time runs the same ticks however
// it is divided into frames.
//
// WHERE THE THRESHOLD COMES FROM. specs/instrumentation.md ("A render-free
// core"): "On `playing`, each frame's delta time joins the accumulator, every
// whole `TICK_DT` in it is consumed as a tick, and the remainder waits for the
// next frame. A tick is consumed while the accumulator is at least
// `TICK_DT − TICK_EPSILON` ... so a frame of `0.5` seconds runs exactly `30`
// ticks and sixty frames of `1 / 60` seconds run exactly `60`. ... An interval
// of game time on `playing` therefore runs the same ticks however it was
// divided into frames, and drawing advances nothing." And of `step`: "On
// `playing` the update is one whole tick of `specs/world.md`, run directly
// rather than through the accumulator", each frame "exactly a frame of the
// loop". specs/enemies.md ("Chase"): a chaser advances "one step of `speed ×
// TICK_DT`" toward the lamplighter every tick, so a moth walking in from
// `MOTH_X` covers `speed × 0.5` units over thirty ticks whatever the frames.
//
// THE THREE DIVISIONS. The same half second three ways, each from the same
// posed night: one frame of `0.5` s through `advance`; fifty frames of `0.01`
// s through `advance`, which the epsilon rule makes consume the thirtieth tick
// on the fiftieth frame, since forty-nine of them sum to `0.49` and thirty
// ticks need `0.5 − 1e-9`; and thirty frames of one tick each through `step`,
// which is the division that bypasses the accumulator altogether. Each leaves
// `run.tick` thirty higher, the moth thirty steps closer, and the bolt thirty
// steps along.
//
// THE NIGHT. `poseLiveNight`: a moth walking, a bolt flying, a puddle and a
// contact cooldown counting, a gem in flight, and Taper's timer counting, so a
// build that integrated with the frame's delta rather than the tick's, `0.5`
// s in one step, fifty steps, and thirty steps, lands the moth and the bolt on
// three different positions.
//
// THE TOLERANCE. `INTEGRATION_TOL`, the `0.1` units an integrated position is
// allowed against the figure the rules give it: thirty steps of a float sum
// stray by far less, and the three divisions would differ by whole steps.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { ENEMIES, INTEGRATION_TOL, TICK_DT, TICK_HZ } from "../constants";
import {
  advanceBy,
  captureReplay,
  createHarness,
  mustEnemy,
  mustProjectile,
  type Harness,
  type WickSnapshot,
} from "../harness";
import {
  BOLT_VY,
  BOLT_X,
  BOLT_Y,
  LIVE_FACULTIES,
  MOTH_X,
  poseLiveNight,
} from "./stage";

/** The span every division covers, in seconds. */
const SPAN = 0.5;

/** The ticks that span is: `0.5 × TICK_HZ`. */
const TICKS = SPAN * TICK_HZ;

/** The small frame of the second division, and how many of them make the span. */
const SMALL_FRAME = 0.01;
const SMALL_FRAMES = SPAN / SMALL_FRAME;

/** Where the moth stands after the span: `MOTH_X` less thirty steps toward the origin. */
const MOTH_X_AFTER = MOTH_X - ENEMIES.moth.speed * TICK_DT * TICKS;

/** Where the bolt stands after the span: thirty steps of its velocity. */
const BOLT_Y_AFTER = BOLT_Y + BOLT_VY * TICK_DT * TICKS;

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
  const before = await poseLiveNight(h, { on: LIVE_FACULTIES });
  await drive();
  const after = await h.snapshot();
  return { before, after };
}

/** Read one division against the ticks and the steps the span owes. */
function assertDivision(division: Division, what: string): void {
  const { before, after } = division;
  assertEqual(
    after.run.tick,
    before.run.tick + TICKS,
    `run.tick after ${what}`,
  );
  const moth = before.run.enemies.find((enemy) => enemy.type === "moth")!;
  assertNear(
    mustEnemy(after, moth.id).x,
    MOTH_X_AFTER,
    INTEGRATION_TOL,
    `the moth's x after ${what}, thirty chase steps from ${MOTH_X}`,
  );
  const bolt = before.run.projectiles[0]!;
  const flown = mustProjectile(after, bolt.id);
  assertNear(flown.x, BOLT_X, INTEGRATION_TOL, `the bolt's x after ${what}`);
  assertNear(
    flown.y,
    BOLT_Y_AFTER,
    INTEGRATION_TOL,
    `the bolt's y after ${what}, thirty steps from ${BOLT_Y}`,
  );
}

it("runs thirty ticks from one frame, fifty small frames, and thirty stepped frames alike", async () => {
  const whole = await divide(() => advanceBy(h, SPAN));
  const small = await divide(async () => {
    for (let i = 0; i < SMALL_FRAMES; i += 1) await advanceBy(h, SMALL_FRAME);
  });
  const ticked = await captureReplay(h, "divided", () =>
    divide(() => h.step(TICKS)),
  );

  assertDivision(whole, "one frame of 0.5 s");
  assertDivision(small, "fifty frames of 0.01 s");
  assertDivision(ticked, "thirty frames of one tick");
});
