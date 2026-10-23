// Carom — the AI opponent (the right paddle in Solo).
//
// Competent but deliberately beatable (specs/modes/single-player.md): it moves
// slower than the human, reacts to the ball with a short delay, keeps a small
// deadzone so it never jitters onto a perfect line, and does not compensate for
// spin curvature — so a well-placed or well-curved shot gets past it. It defends
// ONE ball at a time, the one its caller hands it, and with none to defend it
// eases back toward the vertical center.
//
// It holds no perception of its own. The reaction delay is expressed as WHERE THE
// BALL WAS AI_REACT seconds ago — `ball.y - ball.vy * AI_REACT` — rather than as
// a filter carried between frames, which keeps the opponent a pure function of
// the declared state in `src/game.ts`. That matters: `reset()` restores the
// declared fields and knows nothing about a filter, so a remembered perception
// would survive a reset and stop a scenario replaying identically.
//
// Its two FACULTIES are declared state and are gated on their own
// (specs/instrumentation.md): with `tracking` off it senses nothing and simply
// holds its rest position, and with `movement` off its paddle does not travel at
// all.

import {
  AI_DEADZONE,
  AI_HOME_DEADZONE,
  AI_HOME_Y,
  AI_REACT,
  AI_SPEED,
} from "./constants";
import { integratePaddle } from "./entities";
import type { AiState, BallState, PaddleState } from "./game";
import type { DeepReadonly } from "ts-essentials";

/**
 * The AI's paddle after one frame of play.
 *
 * `ball` is the one ball the AI is defending, `null` when nothing threatens its
 * goal. `live` is true only while the screen is `playing` — while the balls are
 * waiting out the opening countdown there is nothing to defend, so the paddle
 * eases home.
 */
export function updateAi(
  paddle: DeepReadonly<PaddleState>,
  ball: DeepReadonly<BallState> | null,
  ai: DeepReadonly<AiState>,
  live: boolean,
  dt: number,
): PaddleState {
  // Without movement the paddle stays exactly where it is, and its velocity for
  // the frame is zero — which is what the spin mechanic then reads at contact.
  if (!ai.movement) {
    return { ...paddle, vy: 0 };
  }

  let target = AI_HOME_Y;
  let deadzone = AI_HOME_DEADZONE;
  // Without tracking the AI senses nothing, so it holds its rest position
  // whatever the balls are doing.
  const defended = ai.tracking ? ball : null;
  if (live && defended !== null) {
    // The lagged perception: the ball as it was AI_REACT seconds ago.
    target = defended.y - defended.vy * AI_REACT;
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
  return integratePaddle({ ...paddle, vy }, dt);
}
