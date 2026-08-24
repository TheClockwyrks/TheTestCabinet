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
import type { DeepReadonly } from "ts-essentials";

/**
 * The AI's paddle after one frame.
 *
 * `active` is true only while the screen is `playing`: during the pre-serve
 * hold there is nothing to defend, so the paddle returns home, stopping within
 * the wider AI_HOME_DEADZONE of the center.
 */
export function updateAi(
  paddle: DeepReadonly<PaddleState>,
  ball: DeepReadonly<BallState>,
  active: boolean,
  dt: number,
): PaddleState {
  // The lagged perception: the ball as it was AI_REACT seconds ago.
  const perceivedY = ball.y - ball.vy * AI_REACT;

  const incoming = active && ball.vx > 0;
  const target = incoming ? perceivedY : AI_HOME_Y;
  const deadzone = incoming ? AI_DEADZONE : AI_HOME_DEADZONE;

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
