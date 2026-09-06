// Wick — clock/fixed-tick-division: a span of game time runs the same ticks
// however it is divided into frames.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/instrumentation.md` ("A render-free core"): "The simulation
//     advances only in whole ticks of `TICK_DT` (`1 / 60`) seconds ... On
//     `playing`, each frame's delta time joins the accumulator, every whole
//     `TICK_DT` in it is consumed as a tick, and the remainder waits for the
//     next frame ... so a frame of `0.5` seconds runs exactly `30` ticks and
//     sixty frames of `1 / 60` seconds run exactly `60`. ... An interval of
//     game time on `playing` therefore runs the same ticks however it was
//     divided into frames, and drawing advances nothing."
//   - `specs/instrumentation.md` ("What the runtime provides instead"): "a
//     clock of any other length poses a partial frame. `simTime` and
//     `accumulator` behave under such a clock exactly as under the wall clock."
//   - `specs/enemies.md` ("Chase"): a chaser advances "one step of `speed ×
//     TICK_DT`" toward the lamplighter every tick, so a moth walking in from
//     `MOTH_X` covers `speed × 0.5` units over thirty ticks whatever the
//     frames; `specs/weapons.md` ("Projectiles"): a projectile advances by its
//     velocity times `TICK_DT` every tick, so a bolt flying at `BOLT_VY` covers
//     `BOLT_VY × 0.5` units over the same thirty.
//
// THE DRIVE. One isolated run is posed three times with the same operations,
// and half a second is delivered to each in a different division: one frame
// of 500 ms, fifty frames of 10 ms, and thirty frames of `TICK_MS`. Each must
// leave `run.tick` thirty higher, the moth thirty chase steps closer, and the
// bolt thirty steps along. The world is posed so that ticks DO something the
// divisions could disagree on: a moth chasing under `enemyMotion` and a bolt
// flying under `effectMotion`, so a build that integrated with the frame's
// delta rather than the tick's, 0.5 s in one step, fifty steps, and thirty
// steps, lands them on three different positions. The frames of 10 ms are the
// interesting division: no frame is a whole tick, so every tick is assembled
// from parts. Nothing in the world draws at random, so the three runs differ
// in nothing but their division.
//
// TOLERANCE. `MOTION_EPS` on the two integrated positions, the suite's slack
// for a figure summed tick by tick; the tick count is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { ENEMIES, MOTION_EPS, TICK_DT, TICK_HZ, TICK_MS } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  enable,
  enemyById,
  isolate,
  placeEnemy,
  placeProjectile,
  projectileById,
  type Harness,
  type WickSnapshot,
} from "../harness";

/** The span delivered, in seconds, and the ticks it is worth. */
const SPAN_SECONDS = 0.5;
const SPAN_TICKS = SPAN_SECONDS * TICK_HZ;

/** The fifty small frames, in milliseconds each. */
const SMALL_FRAME_MS = 10;
const SMALL_FRAMES = (SPAN_SECONDS * 1000) / SMALL_FRAME_MS;

/** Where the moth is posed: chasing in toward the origin at its speed. */
const MOTH_X = 300;

/** The bolt's start and velocity: off to the left, flying +y, hitting nothing. */
const BOLT_X = -200;
const BOLT_VY = 100;

/** Where the moth stands after the span: thirty chase steps toward the origin. */
const MOTH_X_AFTER = MOTH_X - ENEMIES.moth.speed * TICK_DT * SPAN_TICKS;

/** Where the bolt stands after the span: thirty steps of its velocity. */
const BOLT_Y_AFTER = BOLT_VY * TICK_DT * SPAN_TICKS;

/** One division: the world as posed and the state its drive left. */
interface Division {
  moth: number;
  bolt: number;
  before: WickSnapshot;
  after: WickSnapshot;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** Pose the world afresh, run `drive` over it, and read both ends. */
async function divide(drive: () => Promise<WickSnapshot>): Promise<Division> {
  isolate(h);
  const moth = placeEnemy(h, "moth", MOTH_X, 0);
  const bolt = placeProjectile(h, "ember", BOLT_X, 0, 0, BOLT_VY, 0);
  enable(h, "enemyMotion", "effectMotion");
  const before = h.snapshot();
  const after = await drive();
  return { moth, bolt, before, after };
}

/** Read one division against the ticks and the steps the span owes. */
function assertDivision(division: Division, what: string): void {
  const { before, after } = division;
  assertEqual(
    after.run.tick,
    before.run.tick + SPAN_TICKS,
    `run.tick after ${what}`,
  );
  const moth = enemyById(after, division.moth);
  if (moth === undefined) throw new Error(`the moth is gone after ${what}`);
  assertNear(
    moth.x,
    MOTH_X_AFTER,
    MOTION_EPS,
    `the moth's x after ${what}, thirty chase steps from ${MOTH_X}`,
  );
  const bolt = projectileById(after, division.bolt);
  if (bolt === undefined) throw new Error(`the bolt is gone after ${what}`);
  assertNear(bolt.x, BOLT_X, MOTION_EPS, `the bolt's x after ${what}`);
  assertNear(
    bolt.y,
    BOLT_Y_AFTER,
    MOTION_EPS,
    `the bolt's y after ${what}, thirty steps of ${BOLT_VY} units/s`,
  );
}

it("runs thirty ticks from one frame, fifty small frames, and thirty ticks alike", async () => {
  const one = await divide(() => h.frameOf(SPAN_SECONDS * 1000));
  const fifty = await divide(async () => {
    let last = h.snapshot();
    for (let frame = 0; frame < SMALL_FRAMES; frame += 1) {
      last = await h.frameOf(SMALL_FRAME_MS);
    }
    return last;
  });
  const thirty = await captureReplay(h, "divided", () =>
    divide(() => advanceTicks(h, SPAN_TICKS)),
  );

  assertDivision(one, "one frame of 0.5 s");
  assertDivision(fifty, "fifty frames of 0.01 s");
  assertDivision(thirty, `thirty frames of ${TICK_MS} ms`);
});
