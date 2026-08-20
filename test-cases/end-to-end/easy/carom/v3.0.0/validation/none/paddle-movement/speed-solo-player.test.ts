// paddle-movement/speed-solo-player — the human paddle's speed in Solo.
//
// The match is started from the title with menu keys, so the game stays under
// normal player control — no control op is ever called and the paddles respond to
// held input exactly as they do for a player. A movement key is then held for a
// known span and the displacement is measured back into a speed.

import { afterEach, beforeEach, expect, it } from "vitest";
import { PADDLE_SPEED } from "../../src/constants";
import {
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

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness.dispose();
});

it("moves the human paddle at the paddle speed while a key is held", async () => {
  await startWithKeys(harness, "solo");

  const moved = await holdMove(harness, "left", "KeyS", { ticks: TICKS });

  expect(moved.delta).toBeGreaterThan(0); // KeyS drives it down the field
  expect(
    Math.abs(speedOverTicks(moved.delta, TICKS) - PADDLE_SPEED),
  ).toBeLessThanOrEqual(SPEED_TOLERANCE);
});
