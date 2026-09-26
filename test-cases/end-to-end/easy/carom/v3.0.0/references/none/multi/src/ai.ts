// Carom — the AI opponent (the right paddle in Solo).
//
// Competent but deliberately beatable (specs/modes/single-player.md): it moves
// slower than the human, reacts to the ball with a short delay, keeps a small
// deadzone so it never jitters onto a perfect line, and does not compensate for
// spin curvature — so a well-placed or well-curved shot gets past it. It defends
// ONE ball at a time, the one its caller hands it, and with none to defend it
// eases back toward the vertical center.
//
// It holds NO state of its own. The reaction delay is expressed as WHERE THE BALL
// WAS AI_REACT seconds ago — `ball.y - ball.vy * AI_REACT` — rather than as a
// filter carried between frames, which keeps the opponent a pure function of the
// declared state in `src/game.ts`. That matters: `reset()` restores the declared
// fields and knows nothing about a filter, so a remembered perception would
// survive a reset and stop a scenario replaying identically.
//
// ITS TWO FACULTIES ARE THEMSELVES DECLARED STATE (specs/state.md), each gated on
// its own by the debug surface. Tracking is what SENSES the ball and chooses a
// target: without it the AI targets `AI_HOME_Y` whatever the ball is doing, so a
// scenario can watch a body that moves but does not see. Movement is what TRAVELS
// toward that target: without it the paddle stands still with a `vy` of zero, so a
// scenario can watch a mind that sees but does not move.

import {
  AI_DEADZONE,
  AI_HOME_DEADZONE,
  AI_HOME_Y,
  AI_REACT,
  AI_SPEED,
} from "./constants";
import { integratePaddle } from "./entities";
import type { AiState, BallState, PaddleState } from "./game";

/**
 * Move the AI's paddle for one frame.
 *
 * `ball` is the one ball the AI is defending, `null` when nothing threatens its
 * goal. `live` is true only while the screen is `playing`; during the opening
 * countdown there is nothing to defend, so the paddle eases home.
 */
export function updateAi(
  paddle: PaddleState,
  ball: BallState | null,
  live: boolean,
  ai: AiState,
  dt: number,
): void {
  // Without the movement faculty the paddle simply does not travel: it is left
  // exactly where it is, reporting the zero velocity that is the truth about it.
  if (!ai.movement) {
    paddle.vy = 0;
    return;
  }

  let target = AI_HOME_Y;
  let deadzone = AI_HOME_DEADZONE;
  // Without the tracking faculty the ball is not sensed at all, so the target
  // stays home however the ball is flying.
  if (ai.tracking && live && ball !== null) {
    // The lagged perception: the ball as it was AI_REACT seconds ago.
    target = ball.y - ball.vy * AI_REACT;
    deadzone = AI_DEADZONE;
  }

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
