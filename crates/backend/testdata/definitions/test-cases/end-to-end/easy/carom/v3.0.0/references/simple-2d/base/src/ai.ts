// Carom — the AI opponent (the right paddle in Solo).
//
// Competent but deliberately beatable (specs/modes/single-player.md): it moves
// slower than the human, reacts to the ball with a short delay, keeps a small
// deadzone so it never jitters onto a perfect line, and does not compensate for
// spin curvature — so a well-placed or well-curved shot gets past it. When there
// is nothing to defend it returns toward AI_HOME_Y and stops within the wider
// AI_HOME_DEADZONE of it, so it never twitches around the center line.
//
// It holds NO state of its own. The reaction delay is expressed as WHERE THE BALL
// WAS AI_REACT seconds ago — `ball.y - ball.vy * AI_REACT` — rather than as a
// filter carried between frames, which keeps the opponent a pure function of the
// declared state in `src/game.ts`. That matters: `reset` restores the declared
// fields and knows nothing about a filter, so a remembered perception would
// survive a reset and stop a scenario replaying identically.
//
// Its two faculties are declared state and each is gated on its own
// (specs/instrumentation.md). With `tracking` off it senses nothing and simply
// holds station at home; with `movement` off its paddle stays where it is, at a
// velocity of zero, whatever it can see.

import {
  AI_DEADZONE,
  AI_HOME_DEADZONE,
  AI_HOME_Y,
  AI_REACT,
  AI_SPEED,
} from "./constants";
import { integratePaddle } from "./entities";
import type { AiState, BallState, PaddleState } from "./game";

/** The target the AI steers to, and how close it settles for. */
export function aiTarget(
  ball: BallState | null,
  ai: AiState,
  live: boolean,
): { target: number; deadzone: number } {
  const incoming = ai.tracking && live && ball !== null && ball.vx > 0;
  if (!incoming) return { target: AI_HOME_Y, deadzone: AI_HOME_DEADZONE };
  // The lagged perception: the ball as it was AI_REACT seconds ago.
  return { target: ball.y - ball.vy * AI_REACT, deadzone: AI_DEADZONE };
}

/**
 * The AI's paddle after one frame of its own play.
 *
 * `live` is true only on a `playing` frame — during the pre-serve hold there is
 * nothing to track, so the paddle eases home.
 */
export function aiPaddle(
  paddle: PaddleState,
  ball: BallState | null,
  ai: AiState,
  live: boolean,
  dt: number,
): PaddleState {
  if (!ai.movement) return { ...paddle, vy: 0 };

  const { target, deadzone } = aiTarget(ball, ai, live);
  const diff = target - paddle.cy;
  if (Math.abs(diff) <= deadzone) return integratePaddle(paddle, 0, dt);
  // Never overshoot the target in a single step.
  const reach = dt > 0 ? Math.abs(diff) / dt : AI_SPEED;
  return integratePaddle(
    paddle,
    Math.sign(diff) * Math.min(AI_SPEED, reach),
    dt,
  );
}
