// instrumentation/advance-is-exact — advancing moves exactly the time asked
// for, and an interval of game time reaches the same state however it was
// divided into frames.
//
// THE RULE. `specs/simulation.md`: "The simulation runs on a fixed timestep of
// `TICK_HZ` (`120`) ticks per second, so one tick is `TICK_DT` (`1 / 120` of a
// second) of game time exactly. The simulation advances in whole ticks and never
// in a partial one." Under this engine: "The engine measures how much real time
// each frame covers and hands the game that delta in seconds; it imposes no
// timestep of its own. The game's own timestep is the one above, so the delta a
// frame brings is converted into whole ticks with the remainder carried into the
// next frame." And `specs/instrumentation.md`, A deterministic core: "an
// interval of game time reaches the same state however it was divided into
// frames", with `simTime` accumulating "every tick's `TICK_DT`, whatever the
// screen".
//
// TWO LEGS, AND THE SECOND IS THE ONE WITH TEETH.
//
// THE COUNT. On the suite's own clock a frame is worth exactly one tick, so `n`
// frames must move `simTime` by `n x TICK_DT`. The bound is one tick, which is
// the item's own — a build carrying a fraction of a tick between frames is
// conformant, and one that dropped or doubled a whole tick is not.
//
// THE DIVISION. The same second of real time is covered two ways: as 120 frames
// worth one tick each, and as 100 frames worth `10` milliseconds each. Ten
// milliseconds is `1.2` ticks, so EVERY frame of the second harness carries a
// remainder the next frame has to pick up — which is the sentence
// `specs/simulation.md` states, written as a scenario. Both must reach the same
// `simTime` and leave a posed rock in the same place.
//
// WHY NOT ONE FRAME WORTH A WHOLE SECOND. That would be a stronger-looking check
// and a wrong one: a frame worth 120 ticks is a frame after a stall, and a build
// is free to bound how much simulation one frame may run rather than freeze the
// page catching up. `specs/simulation.md` fixes the step and the carry, not a
// ceiling, so the division here stays inside the frame rates a game actually
// sees — 120 Hz against 100 Hz.
//
// THE ROCK IS WHAT MAKES IT A STATE COMPARISON. `simTime` alone would pass a
// build that counted ticks it never ran. A rock drifting on the quiet ground is
// carried by its own velocity and by the well, so where it ends up is a reading
// of the ticks that actually ran.

import { ConstantClock } from "@test-cabinet/structured-2d";
import { afterEach, beforeEach, it } from "vitest";
import { TICK_DT } from "../../src/constants";
import { assertLessThanOrEqual } from "../assert";
import { QUIET_CORNER } from "../fixtures";
import { driftOver } from "../geometry";
import {
  captureReplay,
  createHarness,
  poseRock,
  requireRock,
  seconds,
  startPlaying,
  TICK_MS,
  ticksFor,
  type Harness,
} from "../harness";

/** The course the rock is posed on, in units per second. */
const POSED_VX = 100;
const POSED_VY = 0;

/** The frame counts the exactness of an advance is read at. */
const COUNTS = [1, 7, ticksFor(1)] as const;

/** The stretch the two divisions cover, in seconds of game time. */
const SPAN_SECONDS = 1;

/**
 * How far an advance's `simTime` may sit from `n x TICK_DT`, in seconds.
 *
 * One tick, which is the item's own bound and the specification's: a build
 * carries a fraction of a tick between frames by design, so the reading is
 * within one tick of the time asked for and never further.
 */
const TIME_TOLERANCE = TICK_DT;

/**
 * The frame the second division steps in, in milliseconds.
 *
 * Ten milliseconds is `1.2` of Shatter's own ticks, so no frame of that harness
 * is a whole number of ticks and the remainder is carried on every one of them —
 * while a hundred of them is exactly the second the other harness covers in 120.
 */
const COARSE_MS = 10;
const COARSE_FRAMES = Math.round((SPAN_SECONDS * 1000) / COARSE_MS);

/**
 * How far the two divisions' rocks may sit apart, in units.
 *
 * They may differ by at most the one tick the time bound above allows, and over
 * one tick the rock moves its own speed times `TICK_DT`. Its speed is the posed
 * velocity plus whatever the well added over the stretch, which `driftOver`
 * answers from the law `specs/gravity.md` fixes.
 */
const PLACE_TOLERANCE =
  (Math.hypot(POSED_VX, POSED_VY) + driftOver(QUIET_CORNER, SPAN_SECONDS)) *
  TICK_DT;

/** Every harness an `it` built for itself, disposed whatever its verdict. */
let built: Harness[] = [];

async function harnessWithStep(stepMs: number): Promise<Harness> {
  const harness = await createHarness({ clock: new ConstantClock(stepMs) });
  built.push(harness);
  return harness;
}

/** The posed rock's id on a freshly posed, quiet field. */
function poseDrifter(harness: Harness): number {
  startPlaying(harness);
  return poseRock(
    harness,
    "large",
    QUIET_CORNER.x,
    QUIET_CORNER.y,
    POSED_VX,
    POSED_VY,
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
  for (const harness of built) harness.dispose();
  built = [];
});

it("moves simTime by exactly the ticks asked for", async () => {
  const id = poseDrifter(h);

  for (const count of COUNTS) {
    const before = h.snapshot().simTime;
    if (count === ticksFor(SPAN_SECONDS)) {
      // A posed rock advanced a second of game time: this point's evidence.
      await captureReplay(h, "advance", () => h.advance(count));
    } else {
      await h.advance(count);
    }
    assertLessThanOrEqual(
      Math.abs(h.snapshot().simTime - before - seconds(count)),
      TIME_TOLERANCE,
      `simTime after advancing ${count} tick(s) of game time`,
    );
  }

  // The rock really ran those ticks rather than the clock alone moving on.
  requireRock(h.snapshot(), id, "the posed rock after the advances");
});

it("reaches the same second whether it is divided into 120 frames or 100", async () => {
  const fine = await harnessWithStep(TICK_MS);
  const coarse = await harnessWithStep(COARSE_MS);

  const fineRock = poseDrifter(fine);
  const coarseRock = poseDrifter(coarse);

  const fineStart = fine.snapshot().simTime;
  const coarseStart = coarse.snapshot().simTime;

  await fine.advance(ticksFor(SPAN_SECONDS));
  await coarse.advance(COARSE_FRAMES);

  const fineElapsed = fine.snapshot().simTime - fineStart;
  const coarseElapsed = coarse.snapshot().simTime - coarseStart;

  assertLessThanOrEqual(
    Math.abs(fineElapsed - SPAN_SECONDS),
    TIME_TOLERANCE,
    "the second covered as 120 frames of one tick each",
  );
  assertLessThanOrEqual(
    Math.abs(coarseElapsed - SPAN_SECONDS),
    TIME_TOLERANCE,
    `the second covered as ${COARSE_FRAMES} frames of ${COARSE_MS} ms, each ` +
      "carrying a remainder into the next",
  );

  const here = requireRock(fine.snapshot(), fineRock, "the 120-frame rock");
  const there = requireRock(
    coarse.snapshot(),
    coarseRock,
    `the ${COARSE_FRAMES}-frame rock`,
  );
  assertLessThanOrEqual(
    Math.hypot(here.x - there.x, here.y - there.y),
    PLACE_TOLERANCE,
    "the two divisions of one second leave the rock in the same place",
  );
});
