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
//
// ITS TWO FACULTIES ARE GATED SEPARATELY (specs/instrumentation.md). `tracking`
// is whether it senses the ball and chooses a target at all — without it the
// target is always home, whatever the ball is doing. `movement` is whether the
// paddle travels toward that target — without it the paddle stands still with a
// `vy` of 0. Both are declared state, so both survive into a snapshot.

import {
  AI_DEADZONE,
  AI_HOME_DEADZONE,
  AI_HOME_Y,
  AI_REACT,
  AI_SPEED,
} from "./constants";
import { integratePaddle } from "./entities";
import type { AiState, BallState, PaddleState } from "./game";

/** Where the AI is trying to put its paddle, and how close counts as arrived. */
export function aiTarget(
  ball: BallState | null,
  live: boolean,
  tracking: boolean,
): { target: number; deadzone: number } {
  // The lagged perception: the ball as it was AI_REACT seconds ago. While the
  // ball travels away, or is not live, or the AI is not sensing it at all, the
  // paddle returns home instead, with the wider deadzone: returning to the middle
  // is a drift rather than a defence.
  const incoming = tracking && live && ball !== null && ball.vx > 0;
  if (!incoming || ball === null) {
    return { target: AI_HOME_Y, deadzone: AI_HOME_DEADZONE };
  }
  return { target: ball.y - ball.vy * AI_REACT, deadzone: AI_DEADZONE };
}

/**
 * Move the AI's paddle for one frame.
 *
 * `live` is true only on a `playing` frame — during the pre-serve hold there is
 * nothing to track, so the paddle eases home.
 */
export function updateAi(
  paddle: PaddleState,
  ball: BallState | null,
  ai: AiState,
  live: boolean,
  dt: number,
): void {
  if (!ai.movement) {
    // The paddle stays exactly where it is, and reports standing still.
    paddle.vy = 0;
    return;
  }

  const { target, deadzone } = aiTarget(ball, live, ai.tracking);
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
