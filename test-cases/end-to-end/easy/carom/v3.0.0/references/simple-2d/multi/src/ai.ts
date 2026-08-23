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

import {
  AI_DEADZONE,
  AI_HOME_DEADZONE,
  AI_HOME_Y,
  AI_REACT,
  AI_SPEED,
} from "./constants";
import { integratePaddle } from "./entities";
import type { BallState, PaddleState } from "./game";

/**
 * The AI's paddle after one frame of play.
 *
 * `ball` is the one ball the AI is defending, `null` when nothing threatens its
 * goal. `active` is true only while the field is live — while the balls are
 * waiting on their home points there is nothing to track, so the paddle eases
 * home.
 */
export function updateAi(
  paddle: PaddleState,
  ball: BallState | null,
  active: boolean,
  dt: number,
): PaddleState {
  let target = AI_HOME_Y;
  let deadzone = AI_HOME_DEADZONE;
  if (active && ball !== null && ball.vx > 0) {
    // The lagged perception: the ball as it was AI_REACT seconds ago.
    target = ball.y - ball.vy * AI_REACT;
    deadzone = AI_DEADZONE;
  }

  const diff = target - paddle.cy;
  let vy: number;
  if (Math.abs(diff) <= deadzone) {
    vy = 0;
  } else {
    // Never overshoot the target in a single step.
    const reach = dt > 0 ? Math.abs(diff) / dt : AI_SPEED;
    vy = Math.sign(diff) * Math.min(AI_SPEED, reach);
  }
  return integratePaddle({ cy: paddle.cy, vy }, dt);
}
