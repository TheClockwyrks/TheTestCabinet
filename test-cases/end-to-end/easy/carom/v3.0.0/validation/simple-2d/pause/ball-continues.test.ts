// Carom — pause/ball-continues: after unpausing, the ball carries on from exactly
// where it was suspended, at the velocity it was suspended with.
//
// The fault this catches is a build that treats resuming as a fresh start: a
// re-serve, or a jump back to the centre. The ball is posed in mid-flight,
// frozen, confirmed still, and then resumed, and where it is a known number of
// frames later is compared against where its own preserved velocity carries it
// from the paused position: `x += vx * h` each sub-step (specs/balls.md), with
// no spin and nothing to strike, is `vx * elapsed` over the whole span.
//
// The resume frame counts. Each update reads input first and then advances the
// screen it left (specs/ui.md), so the frame that consumed the resume is a
// frame of flight. The margin is one sub-step of travel, MAX_SUBSTEP units.

import { afterEach, beforeEach, it } from "vitest";
import { MAX_SUBSTEP } from "../constants";
import { assertCloseTo, assertEqual, assertLessThanOrEqual } from "../assert";
import {
  arrangeLiveBall,
  ball0,
  captureReplay,
  createHarness,
  TICK_HZ,
  type Harness,
} from "../harness";

/** Frames run after the resume key, the resuming frame included. */
const RESUMED_TICKS = 24;

/** How long the ball is left hanging before it is resumed. */
const FROZEN_TICKS = 120; // 1 s

/**
 * How much of the freeze is recorded, out of the whole of it: enough still
 * frames in front of the resume that the clip shows the ball had stopped.
 */
const HANGING_TICKS = 48; // 0.4 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("resumes the ball from its paused position at its preserved velocity", async () => {
  await arrangeLiveBall(h, { x: 500, y: 360, vx: 400, vy: -120 });

  await h.advance(30); // 0.25 s of visible flight
  await h.tap("Escape");
  const paused = h.snapshot();
  assertEqual(paused.screen, "paused");

  await h.advance(FROZEN_TICKS - HANGING_TICKS);

  const held = await captureReplay(h, "continues", async () => {
    await h.advance(HANGING_TICKS);
    // The end of the freeze, read on exactly the frame it was read on before.
    const still = h.snapshot();

    await h.tap("Escape"); // resume, which is itself one frame of flight
    await h.advance(RESUMED_TICKS - 1);
    return still;
  });
  assertEqual(ball0(held).x, ball0(paused).x);
  assertEqual(ball0(held).y, ball0(paused).y);

  const resumed = h.snapshot();
  assertEqual(resumed.screen, "playing");

  const elapsed = RESUMED_TICKS / TICK_HZ;
  const expectedX = ball0(paused).x + ball0(paused).vx * elapsed;
  const expectedY = ball0(paused).y + ball0(paused).vy * elapsed;
  assertLessThanOrEqual(Math.abs(ball0(resumed).x - expectedX), MAX_SUBSTEP);
  assertLessThanOrEqual(Math.abs(ball0(resumed).y - expectedY), MAX_SUBSTEP);
  // Unchanged to a float margin: the flight integrates a spin of zero, and how
  // a build rotates a velocity by zero radians is its own.
  assertCloseTo(ball0(resumed).vx, ball0(paused).vx, 6);
  assertCloseTo(ball0(resumed).vy, ball0(paused).vy, 6);
});
