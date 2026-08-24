// paddle-movement/speed-solo-ai — the AI paddle's chase speed.
//
// The REAL AI is handed control of its paddle and given a ball far down the field
// to chase, and the distance it covers over a short window while chasing at full
// speed is measured back into a speed. Nothing poses the AI's motion: its own
// tracking, at its own pace, is what is measured.
//
// The rate follows from the AI rule (specs/modes/single-player.md): with the
// ball far from the paddle, `|diff|` is far past AI_DEADZONE and `|diff| / dt`
// is far past AI_SPEED, so `vy = sign(diff) * AI_SPEED` on every frame of the
// window and the paddle covers exactly AI_SPEED units per second.

import { afterEach, beforeEach, it } from "vitest";
import { AI_SPEED } from "../../src/constants";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import {
  arrangeAiChase,
  captureReplay,
  createHarness,
  driveAiChaseSpeed,
  type Harness,
} from "../harness";

/** The review item's margin: two percent of AI_SPEED. */
const SPEED_TOLERANCE = AI_SPEED * 0.02;

/**
 * Frames of the chase recorded after the measured window.
 *
 * `driveAiChaseSpeed` measures over a tenth of a second, and that window has to
 * stay where it is: it is short enough that the AI is at full stride throughout,
 * which is what makes the reading a chase SPEED rather than an average over its
 * easing. Twelve frames is not a clip, though, and the review item promises "the
 * AI paddle chasing at its speed". So the rest of the chase is recorded after the
 * measurement, inside the same section — the AI is still short of the ball when
 * these run out, so what the clip shows is a paddle running the field down.
 */
const CHASE_TICKS = 84; // 0.7 s

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("chases the ball at AI_SPEED", async () => {
  await arrangeAiChase(harness);

  const chase = await captureReplay(harness, "move", async () => {
    const measured = await driveAiChaseSpeed(harness);
    await harness.advance(CHASE_TICKS);
    return measured;
  });

  assertGreaterThan(chase.delta, 0); // toward the ball, down the field
  assertLessThanOrEqual(Math.abs(chase.speed - AI_SPEED), SPEED_TOLERANCE);
});
