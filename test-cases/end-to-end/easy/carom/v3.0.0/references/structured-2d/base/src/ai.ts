// Carom — the AI opponent (the right paddle in Solo).
//
// Competent but deliberately beatable (specs/modes/single-player.md): it moves
// slower than the human, reacts to the ball with a short delay, keeps a small
// deadzone so it never jitters onto a perfect line, and does not compensate for
// spin curvature — so a well-placed or well-curved shot gets past it. When the
// ball travels away it returns toward AI_HOME_Y and stops within the wider
// AI_HOME_DEADZONE of it, so it never twitches around the center line.
//
// It holds NO state of its own. The reaction delay is expressed as WHERE THE
// BALL WAS AI_REACT seconds ago — `ball.y - ball.vy * AI_REACT` — rather than
// as a filter carried between frames, which keeps the opponent a pure function
// of the world it can see. That matters: `reset()` restores the declared state
// and knows nothing about a filter, so a remembered perception would survive a
// reset and stop a scenario replaying identically.
//
// `aiVelocity` answers with the VELOCITY the AI asks its paddle for; the paddle
// pawn then integrates it through the same `integratePaddle` a human-driven
// paddle goes through, so every mover of a paddle shares one integrator
// (specs/playfield.md). `AiPaddleController` in `src/match-mode.ts` is the
// caller.

import {
  AI_DEADZONE,
  AI_HOME_DEADZONE,
  AI_HOME_Y,
  AI_REACT,
  AI_SPEED,
} from "./constants";
import type { BallSim } from "./sim";

/**
 * The velocity the AI drives its paddle at for one frame of its own play, in
 * units per second.
 *
 * `active` is true only while the ball is live — during the pre-serve hold
 * there is nothing to track, so the paddle eases home.
 */
export function aiVelocity(
  cy: number,
  ball: BallSim,
  active: boolean,
  dt: number,
): number {
  // The lagged perception: the ball as it was AI_REACT seconds ago.
  const perceivedY = ball.y - ball.vy * AI_REACT;

  const incoming = active && ball.vx > 0;
  const target = incoming ? perceivedY : AI_HOME_Y;
  const deadzone = incoming ? AI_DEADZONE : AI_HOME_DEADZONE;

  const diff = target - cy;
  if (Math.abs(diff) <= deadzone) return 0;
  // Never overshoot the target in a single step.
  const reach = dt > 0 ? Math.abs(diff) / dt : AI_SPEED;
  return Math.sign(diff) * Math.min(AI_SPEED, reach);
}
