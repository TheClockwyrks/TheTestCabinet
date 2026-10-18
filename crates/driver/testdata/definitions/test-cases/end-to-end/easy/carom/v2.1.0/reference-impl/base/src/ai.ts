// Carom — the AI opponent (right paddle in Solo).
//
// Competent but deliberately beatable: it moves slower than the human, reacts
// to the ball with a short lag, keeps a small deadzone so it never jitters onto
// a perfect line, and does not compensate for spin curvature — so a well-placed
// or well-curved shot can get past it. When the ball travels away, it drifts
// back toward the vertical center.

import {
  AI_DEADZONE,
  AI_REACT,
  AI_SPEED,
  FIELD_H,
  PADDLE_MAX_CY,
  PADDLE_MIN_CY,
} from "./constants";
import { clamp, type Ball, type Paddle } from "./entities";

export class AI {
  // A lagged perception of the ball's y: a first-order filter with time
  // constant AI_REACT, giving the ~0.12 s reaction delay.
  private perceivedY = FIELD_H / 2;

  reset(): void {
    this.perceivedY = FIELD_H / 2;
  }

  // `active` is true only while the ball is live (not during the pre-serve hold).
  update(paddle: Paddle, ball: Ball, active: boolean, dt: number): void {
    this.perceivedY += (ball.y - this.perceivedY) * clamp(dt / AI_REACT, 0, 1);

    let target: number;
    let deadzone: number;
    if (active && ball.vx > 0) {
      // Ball incoming: track it (through the lagged perception).
      target = this.perceivedY;
      deadzone = AI_DEADZONE;
    } else {
      // Ball outgoing or held: ease back toward center.
      target = FIELD_H / 2;
      deadzone = 18;
    }

    const diff = target - paddle.cy;
    if (Math.abs(diff) <= deadzone) {
      paddle.vy = 0;
    } else {
      const dir = Math.sign(diff);
      // Never overshoot the target in a single step.
      const speed = Math.min(AI_SPEED, Math.abs(diff) / dt);
      paddle.vy = dir * speed;
    }
    paddle.cy = clamp(
      paddle.cy + paddle.vy * dt,
      PADDLE_MIN_CY,
      PADDLE_MAX_CY,
    );
  }
}
