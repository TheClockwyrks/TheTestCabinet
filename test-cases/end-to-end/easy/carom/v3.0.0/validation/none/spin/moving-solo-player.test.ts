// spin/moving-solo-player — the human paddle, moving downward as it strikes, imparts spin (Solo).
//
// specs/balls.md: on a paddle hit, `spin = clamp(spin + paddleVy *
// SPIN_FROM_PADDLE, -SPIN_CLAMP, SPIN_CLAMP)`, with `paddleVy` the paddle's
// integrated velocity for the frame. A spinless ball struck by a paddle moving
// at `PADDLE_SPEED` therefore leaves with spin `PADDLE_SPEED * SPIN_FROM_PADDLE`
// (612), and five percent is rounding room on that. The ball approaches at
// `FACE_SHOT_SPEED`, one sub-step per frame, so the frame of the contact ends
// with exactly the spin the formula produced.
//
// The paddle is posed moving at the full speed and led upstream by the run-up,
// so it is travelling at `PADDLE_SPEED`, clear of both bounds, as it strikes.
//
// The contact sits below mid-field so the swing has room: over the run-up a
// full-speed paddle covers 360 units, and it starts that far upstream.
import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertLessThanOrEqual } from "../assert";
import { PADDLE_SPEED, SPIN_FROM_PADDLE } from "../constants";
import {
  FACE_SHOT_SPEED,
  LEAD_TICKS,
  arrangePaddleHit,
  captureReplay,
  createHarness,
  drivePaddleHit,
  startPlaying,
  type Harness,
} from "../harness";

const CONTACT_CY = 480;
const CONTACT_BALL_Y = 500;
const EXPECTED_SPIN = PADDLE_SPEED * SPIN_FROM_PADDLE;
const SPIN_TOLERANCE = Math.abs(EXPECTED_SPIN) * 0.05;

/** Frames of the return flight recorded after the contact, for the replay. */
const RETURN_TICKS = 90; // 0.75 s

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("imparts PADDLE_SPEED * SPIN_FROM_PADDLE off a downward swing of the human paddle", async () => {
  await startPlaying(harness, "solo");
  await arrangePaddleHit(harness, "left", {
    cy: CONTACT_CY,
    vy: PADDLE_SPEED,
    ballY: CONTACT_BALL_Y,
    approachSpeed: FACE_SHOT_SPEED,
    leadTicks: LEAD_TICKS,
  });

  const contact = await captureReplay(harness, "curve", async () => {
    const rebound = await drivePaddleHit(harness, "left", {
      leadTicks: LEAD_TICKS,
    });
    await harness.advance(RETURN_TICKS);
    return rebound;
  });

  assertEqual(contact.hit, true);
  assertCloseTo(contact.paddle.vy, PADDLE_SPEED, 6);
  assertLessThanOrEqual(
    Math.abs(contact.ball.spin - EXPECTED_SPIN),
    SPIN_TOLERANCE,
  );
});
