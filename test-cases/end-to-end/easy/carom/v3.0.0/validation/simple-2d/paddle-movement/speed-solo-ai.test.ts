// paddle-movement/speed-solo-ai — the AI paddle's chase speed.
//
// The REAL AI is handed control of its paddle and given a ball far down the field
// to chase, and the distance it covers over a short window while chasing at full
// speed is measured back into a speed. Nothing poses the AI's motion: its own
// tracking, at its own pace, is what is measured.
//
// The bound is a band rather than a figure. The AI eases off as it nears its
// target and its speed is deliberately below the human's so it stays beatable, so
// what a check can honestly require is that it chases at a competent,
// non-trivial rate AND stays slower than a player.

import { afterEach, beforeEach, expect, it } from "vitest";
import { PADDLE_SPEED } from "../../src/constants";
import {
  arrangeAiChase,
  captureReplay,
  createHarness,
  driveAiChaseSpeed,
  type Harness,
} from "../harness";

/** The old browser suite's floor: a competent, non-trivial chase, in px/s. */
const CHASE_FLOOR = 250;

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

it("chases the ball competently, and slower than a human paddle", async () => {
  await arrangeAiChase(harness);

  const chase = await captureReplay(harness, "move", async () => {
    const measured = await driveAiChaseSpeed(harness);
    await harness.advance(CHASE_TICKS);
    return measured;
  });

  expect(chase.speed).toBeGreaterThan(CHASE_FLOOR);
  expect(chase.speed).toBeLessThan(PADDLE_SPEED);
});
