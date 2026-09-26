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
// TWO FACULTIES, GATED ON THEIR OWN (specs/instrumentation.md). `tracking` is
// whether the opponent SENSES the ball and chooses a target; `movement` is
// whether its paddle TRAVELS toward that target. They are separate because a
// single switch cannot express "watch what it decides while its body is held
// still", and they are declared state (specs/state.md) rather than arguments
// the caller invents. With tracking off the target is AI_HOME_Y with
// AI_HOME_DEADZONE whatever the ball is doing; with movement off the paddle
// stands where it is, with `vy` of `0`.
//
// `aiVelocity` answers with the VELOCITY the AI asks its paddle for; the paddle
// pawn then integrates it through the same `integratePaddle` a human-driven
// paddle goes through, so every mover of a paddle shares one integrator
// (specs/playfield.md).

import {
  AI_DEADZONE,
  AI_HOME_DEADZONE,
  AI_HOME_Y,
  AI_REACT,
  AI_SPEED,
} from "./constants";
import type { BallSim } from "./sim";

/** The AI's two faculties, each gated on its own (specs/state.md). */
export interface AiFaculties {
  /** Whether the AI senses the ball and chooses a target. */
  tracking: boolean;
  /** Whether the AI's paddle travels toward that target. */
  movement: boolean;
}

/** What the AI can see this frame: the ball, if there is one, and the screen. */
export interface AiView {
  /** The ball the opponent is defending against, or `null` while none is present. */
  ball: BallSim | null;
  /** Whether the screen is `playing` — the one screen the ball is tracked on. */
  playing: boolean;
}

/**
 * The velocity the AI drives its paddle at for one frame, in units per second.
 *
 * The rule is specs/modes/single-player.md's, in its order: the home target
 * unless the screen is `playing` and the ball is travelling this way, then the
 * deadzone test, then a step that never overshoots the target.
 */
export function aiVelocity(
  cy: number,
  view: AiView,
  faculties: AiFaculties,
  dt: number,
): number {
  // The body is held: it stands where it is, whatever the eyes decided.
  if (!faculties.movement) return 0;

  const ball = view.ball;
  // The lagged perception: the ball as it was AI_REACT seconds ago. Sensing is
  // a faculty of its own, so a blinded opponent tracks nothing and eases home.
  const incoming =
    faculties.tracking && view.playing && ball !== null && ball.vx > 0;
  const target = incoming ? ball.y - ball.vy * AI_REACT : AI_HOME_Y;
  const deadzone = incoming ? AI_DEADZONE : AI_HOME_DEADZONE;

  const diff = target - cy;
  if (Math.abs(diff) <= deadzone) return 0;
  // Never overshoot the target in a single step.
  const reach = dt > 0 ? Math.abs(diff) / dt : AI_SPEED;
  return Math.sign(diff) * Math.min(AI_SPEED, reach);
}
