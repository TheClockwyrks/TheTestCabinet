// Carom — pause/ball-continues: after unpausing, the ball carries on from exactly
// where it was suspended, at the velocity it was suspended with.
//
// The fault this catches is a build that treats resuming as a fresh start: a
// re-serve, or a jump back to the centre. So the ball is posed in mid-flight, the
// game is put on `paused`, the ball is left hanging, and then play is resumed —
// and where the ball is a known number of frames later is compared against where
// its own preserved velocity carries it from the position it was hanging at:
// `x += vx * h` each sub-step (specs/balls.md), with no spin and nothing to
// strike, is `vx * elapsed` over the whole span.
//
// The expectation is measured from the ball AT THE INSTANT OF THE RESUME rather
// than from the instant of the pause. Whether those two are the same position is
// `pause/ball-suspended`'s requirement, and reading this point off the earlier one
// would fail it for that point's defect.
//
// The pause is POSED and the resume is PRESSED, because they are different
// things to this point. Being paused with a ball hanging in flight is the
// precondition, and `setScreen("paused")` poses it without asking whether a key
// can reach that screen — that is `controls-solo/escape` and
// `controls-versus/escape`'s point. UNPAUSING is the act under test, so it is a
// real `Escape` press, and the frame that consumes it counts: each update reads
// input first and then advances the screen the input left it on (specs/ui.md), so
// the resuming frame is itself a frame of flight and `RESUMED_TICKS` includes
// it.
//
// The field holds that ball and nothing else. `arrangeLiveBall` empties it with
// `clearWorld` and spawns back the one ball this point is about, so the flight is
// a straight line with no obstacle to strike. The two paddles are the field
// furniture no operation removes, so they are DRIVEN out of the lane instead.
//
// The margin is one sub-step of travel, MAX_SUBSTEP units: a build is free to cut
// the frame into sub-steps wherever specs/balls.md allows, and that is the width
// of the disagreement that admits.

import { afterEach, beforeEach, it } from "vitest";
import { MAX_SUBSTEP } from "../constants";
import { assertCloseTo, assertEqual, assertLessThanOrEqual } from "../assert";
import {
  arrangeLiveBall,
  ball0,
  captureReplay,
  createHarness,
  openPause,
  TICK_HZ,
  type Harness,
} from "../harness";

/** Frames run from the resume key onward, the resuming frame included. */
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
  arrangeLiveBall(h, { x: 500, y: 360, vx: 400, vy: -120 });

  await h.advance(30); // 0.25 s of visible flight
  openPause(h, "playing");
  assertEqual(h.snapshot().screen, "paused");

  await h.advance(FROZEN_TICKS - HANGING_TICKS);

  const still = await captureReplay(h, "continues", async () => {
    await h.advance(HANGING_TICKS);
    // The ball as the resume finds it, read on the last frozen frame.
    const hanging = h.snapshot();

    await h.tap("Escape"); // the resume, which is itself one frame of flight
    await h.advance(RESUMED_TICKS - 1);
    return hanging;
  });

  const resumed = h.snapshot();
  assertEqual(resumed.screen, "playing");

  const elapsed = RESUMED_TICKS / TICK_HZ;
  const expectedX = ball0(still).x + ball0(still).vx * elapsed;
  const expectedY = ball0(still).y + ball0(still).vy * elapsed;
  assertLessThanOrEqual(Math.abs(ball0(resumed).x - expectedX), MAX_SUBSTEP);
  assertLessThanOrEqual(Math.abs(ball0(resumed).y - expectedY), MAX_SUBSTEP);
  // Unchanged to a float margin: the flight integrates a spin of zero, and how
  // a build rotates a velocity by zero radians is its own.
  assertCloseTo(ball0(resumed).vx, ball0(still).vx, 6);
  assertCloseTo(ball0(resumed).vy, ball0(still).vy, 6);
});
