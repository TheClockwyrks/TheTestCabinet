// Carom — the AI opponent (the right paddle in Solo).
//
// Competent but deliberately beatable (specs/modes/single-player.md): it moves
// slower than the human, reacts to the ball with a short delay, keeps a small
// deadzone so it never jitters onto a perfect line, and does not compensate for
// spin curvature — so a well-placed or well-curved shot gets past it. When the
// ball travels away it eases back toward the vertical center.
//
// It holds NO state of its own. The reaction delay is expressed as WHERE THE BALL
// WAS AI_REACT seconds ago — `ball.y - ball.vy * AI_REACT` — rather than as a
// filter carried between frames, which keeps the opponent a pure function of the
// declared state in `src/state.ts`. That matters: `reset()` restores the declared
// fields and knows nothing about a filter, so a remembered perception would
// survive a reset and stop a scenario replaying identically.

import {
  AI_DEADZONE,
  AI_HOME_DEADZONE,
  AI_HOME_Y,
  AI_REACT,
  AI_SPEED,
} from "./constants";
import { integratePaddle } from "./entities";
import type { AiState, BallState, PaddleState } from "./state";

/**
 * Move the AI's paddle for one frame.
 *
 * The two faculties gate the rule separately (specs/instrumentation.md). Without
 * `movement` the paddle stays where it is, at rest, whatever it can see; without
 * `tracking` it senses nothing and eases home, whatever the ball is doing.
 *
 * `live` is true only while the ball is in play — during the pre-serve hold there
 * is nothing to track, so the paddle eases home. A field with no ball on it is
 * the same case.
 */
export function updateAi(
  paddle: PaddleState,
  ball: BallState | null,
  ai: AiState,
  live: boolean,
  dt: number,
): void {
  if (!ai.movement) {
    paddle.vy = 0;
    return;
  }

  const incoming = ai.tracking && live && ball !== null && ball.vx > 0;
  // The lagged perception: the ball as it was AI_REACT seconds ago.
  const perceivedY = ball === null ? AI_HOME_Y : ball.y - ball.vy * AI_REACT;
  const target = incoming ? perceivedY : AI_HOME_Y;
  const deadzone = incoming ? AI_DEADZONE : AI_HOME_DEADZONE;

  const diff = target - paddle.cy;
  if (Math.abs(diff) <= deadzone) {
    paddle.vy = 0;
  } else {
    // Never overshoot the target in a single step.
    const reach = dt > 0 ? Math.abs(diff) / dt : AI_SPEED;
    paddle.vy = Math.sign(diff) * Math.min(AI_SPEED, reach);
  }
  integratePaddle(paddle, dt);
}
