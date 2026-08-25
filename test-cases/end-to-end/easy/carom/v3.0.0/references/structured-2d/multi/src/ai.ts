// Carom — the AI opponent (the right paddle in Solo).
//
// Competent but deliberately beatable (specs/modes/single-player.md): it moves
// slower than the human, reacts to the ball with a short delay, keeps a small
// deadzone so it never jitters onto a perfect line, and does not compensate for
// spin curvature — so a well-placed or well-curved shot gets past it. With
// three balls in play it defends ONE at a time — of those flying at its goal,
// the one arriving soonest (`threatBall`) — and with none to defend it eases
// back toward AI_HOME_Y, stopping within the wider AI_HOME_DEADZONE so it never
// twitches around the center line.
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
  P2_X0,
} from "./constants";
import type { BallSim, RallyBall } from "./sim";

/**
 * The ball the AI defends: among the balls in flight with `vx > 0` and
 * `x < P2_X0`, the one with the smallest time to its goal, `(P2_X0 - x) / vx`
 * (specs/modes/single-player.md). `null` when no ball qualifies.
 */
export function threatBall(balls: readonly RallyBall[]): RallyBall | null {
  let soonest: RallyBall | null = null;
  let bestTime = Infinity;
  for (const ball of balls) {
    if (ball.held || ball.vx <= 0 || ball.x >= P2_X0) continue;
    const time = (P2_X0 - ball.x) / ball.vx;
    if (time < bestTime) {
      bestTime = time;
      soonest = ball;
    }
  }
  return soonest;
}

/**
 * The velocity the AI drives its paddle at for one frame of its own play, in
 * units per second.
 *
 * `ball` is the one ball the AI is defending, `null` when nothing threatens
 * its goal. `active` is true only while the field is live — while the balls
 * wait on their home points there is nothing to track, so the paddle eases
 * home.
 */
export function aiVelocity(
  cy: number,
  ball: BallSim | null,
  active: boolean,
  dt: number,
): number {
  let target = AI_HOME_Y;
  let deadzone = AI_HOME_DEADZONE;
  if (active && ball !== null && ball.vx > 0) {
    // The lagged perception: the ball as it was AI_REACT seconds ago.
    target = ball.y - ball.vy * AI_REACT;
    deadzone = AI_DEADZONE;
  }

  const diff = target - cy;
  if (Math.abs(diff) <= deadzone) return 0;
  // Never overshoot the target in a single step.
  const reach = dt > 0 ? Math.abs(diff) / dt : AI_SPEED;
  return Math.sign(diff) * Math.min(AI_SPEED, reach);
}
