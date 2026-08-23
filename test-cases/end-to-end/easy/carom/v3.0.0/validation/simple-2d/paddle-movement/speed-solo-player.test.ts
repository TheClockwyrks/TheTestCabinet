// paddle-movement/speed-solo-player — the human paddle's speed in Solo.
//
// The match is started from the title with menu keys, so the game stays under
// normal player control — no control op is ever called and the paddles respond to
// held input exactly as they do for a player. A movement key is then held for a
// known span and the displacement is measured back into a speed.

import { afterEach, beforeEach, expect, it } from "vitest";
import { PADDLE_SPEED } from "../../src/constants";
import {
  captureReplay,
  createHarness,
  holdMove,
  speedOverTicks,
  startWithKeys,
  type Harness,
} from "../harness";

/** The old browser suite's margin: 20% of the spec paddle speed. */
const SPEED_TOLERANCE = PADDLE_SPEED * 0.2;
/** The measured span, in frames of the harness's clock. */
const TICKS = 36; // 0.3 s

/**
 * Frames recorded either side of the measured hold.
 *
 * The measurement is the displacement over `TICKS` frames of held key, and it
 * does not move. What a reviewer needs around it is context: a paddle at rest
 * before the key goes down and a paddle at rest after it comes up is what makes
 * the span between them read as the key's doing rather than as a jump cut.
 *
 * Both stretches fall inside the pre-serve countdown, so nothing else on the
 * field is moving while they run and nothing they do can reach an assertion —
 * `holdMove` takes its own before-and-after readings across the hold alone.
 */
const REST_TICKS = 12; // 0.1 s at rest before the hold
const SETTLED_TICKS = 24; // 0.2 s at rest after the release

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("moves the human paddle at the paddle speed while a key is held", async () => {
  await startWithKeys(harness, "solo");

  const moved = await captureReplay(harness, "move", async () => {
    await harness.advance(REST_TICKS);
    const held = await holdMove(harness, "left", "KeyS", { ticks: TICKS });
    await harness.advance(SETTLED_TICKS);
    return held;
  });

  expect(moved.delta).toBeGreaterThan(0); // KeyS drives it down the field
  expect(
    Math.abs(speedOverTicks(moved.delta, TICKS) - PADDLE_SPEED),
  ).toBeLessThanOrEqual(SPEED_TOLERANCE);
});
