// spin/moving-solo-ai — the AI's paddle, moving as it strikes, imparts spin too.
//
// The REAL AI is handed control of its paddle and a ball is aimed to arrive while
// it is still sweeping down the field to intercept, so it strikes while moving.
// Nothing poses the AI's velocity: its own chase is what curves the ball.
//
// WHY THE BOUND IS RELATIVE. The spin imparted must TRACK the paddle's own
// motion, not clear a fixed magnitude. The AI is deliberately slower than a human
// and eases off as it nears the ball, so its contact speed — and therefore its
// spin — is whatever its own chase produced. A fixed floor tuned to a hard human
// swing would reject a conformant, gentler AI that applies the mechanic
// perfectly. Reading the spin against the paddle's actual `vy` is robust to how
// fast the AI happens to be moving, while still catching a build that imparts no
// spin, or the wrong spin, from an AI contact.

import { afterEach, beforeEach, expect, it } from "vitest";
import { SPIN_FROM_PADDLE } from "../../src/constants";
import {
  arrangeAiMovingHit,
  createHarness,
  drivePaddleHit,
  type Harness,
} from "../harness";

/** The AI must be genuinely moving when it strikes, or there is nothing to read. */
const MOVING_FLOOR = 100;
/** The old browser suite's margin: a quarter of the expected spin, or 50 px/s². */
const RELATIVE_TOLERANCE = 0.25;
const ABSOLUTE_TOLERANCE = 50;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness.dispose();
});

it("imparts spin tracking the AI paddle's own speed", async () => {
  await arrangeAiMovingHit(harness);

  const contact = await drivePaddleHit(harness, "right");

  expect(contact.hit).toBe(true);
  expect(contact.paddle.vy).toBeGreaterThan(MOVING_FLOOR);

  const expected = contact.paddle.vy * SPIN_FROM_PADDLE;
  expect(Math.abs(contact.ball.spin - expected)).toBeLessThanOrEqual(
    Math.max(ABSOLUTE_TOLERANCE, Math.abs(expected) * RELATIVE_TOLERANCE),
  );
});
