// Carom — the AI opponent (the right paddle in Solo).
//
// Competent but deliberately beatable (specs/modes/single-player.md): it moves
// slower than the human, reacts to the ball with a short delay, keeps a small
// deadzone so it never jitters onto a perfect line, and does not compensate for
// spin curvature — so a well-placed or well-curved shot gets past it. When the
// ball travels away it eases back toward the vertical center.
//
// It holds NO state of its own beyond the two faculties `specs/state.md`
// declares. The reaction delay is expressed as WHERE THE BALL WAS AI_REACT
// seconds ago — `ball.y - ball.vy * AI_REACT` — rather than as a filter carried
// between frames, which keeps the opponent a pure function of the declared state.
// That matters: `reset` restores the declared fields and knows nothing about a
// filter, so a remembered perception would survive a reset and stop a scenario
// replaying identically.
//
// The two faculties are gated separately (specs/instrumentation.md):
//
//   * TRACKING is the AI's senses. Without it the AI has no idea where the ball
//     is, so its target is AI_HOME_Y with AI_HOME_DEADZONE whatever the ball is
//     doing — the paddle still travels, just toward home.
//   * MOVEMENT is the AI's legs. Without them the paddle stays where it is with
//     `vy` of 0, however good its target is.
//
// Splitting them is what lets a check separate "it did not see the ball" from
// "it saw the ball and did not move".

import {
  AI_DEADZONE,
  AI_HOME_DEADZONE,
  AI_HOME_Y,
  AI_REACT,
  AI_SPEED,
} from "./constants";
import { integratePaddle, type PaddleMotion } from "./entities";
import type { AiState, BallState } from "./game";
import type { DeepReadonly } from "ts-essentials";

/** Where the AI is trying to put its paddle, and how close is close enough. */
export interface AiTarget {
  readonly target: number;
  readonly deadzone: number;
}

/**
 * The AI's target for this frame.
 *
 * The ball is defended only while it is on its way over — `screen` is `playing`
 * and `vx > 0` — and only while the AI can sense it at all. Everything else sends
 * it home, which is also where a field with no ball leaves it.
 */
export function aiTarget(
  ai: DeepReadonly<AiState>,
  ball: DeepReadonly<BallState> | null,
  playing: boolean,
): AiTarget {
  const incoming = ai.tracking && playing && ball !== null && ball.vx > 0;
  if (!incoming) return { target: AI_HOME_Y, deadzone: AI_HOME_DEADZONE };
  // The lagged perception: the ball as it was AI_REACT seconds ago.
  return { target: ball.y - ball.vy * AI_REACT, deadzone: AI_DEADZONE };
}

/**
 * The AI's paddle after one frame.
 *
 * `playing` is true only while the screen is `playing`: during the pre-serve
 * hold there is nothing to defend, so the paddle returns home, stopping within
 * the wider AI_HOME_DEADZONE of the center.
 */
export function updateAi(
  paddle: DeepReadonly<PaddleMotion>,
  ai: DeepReadonly<AiState>,
  ball: DeepReadonly<BallState> | null,
  playing: boolean,
  dt: number,
): PaddleMotion {
  // No legs: the paddle stands exactly where it is, and reports no velocity, so
  // it imparts no spin to a ball that reaches it.
  if (!ai.movement) return { cy: paddle.cy, vy: 0 };

  const { target, deadzone } = aiTarget(ai, ball, playing);
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
