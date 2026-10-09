// Carom — the rally: the one actor whose tick runs the frame's holds, launches,
// and collective physics.
//
// The balls do not run alone. specs/balls.md counts every waiting ball's hold
// down on the same frame, launches each on the frame its own hold elapses,
// advances the balls in flight TOGETHER in sub-steps sized by the fastest of
// them, and resolves every pair in contact at the end of each sub-step. That is
// a computation over the whole set, so it lives in one place rather than in
// each ball's own tick — which also keeps it independent of the order the balls
// were spawned in, and a field cleared and respawned one ball at a time
// (specs/instrumentation.md) has no meaningful spawn order left.
//
// Each level spawns the rally AFTER the paddles, so by the time this tick runs
// the paddles carry their integrated velocities for the frame, which is what
// the spin mechanic reads at contact. The flight itself is handed to the pure
// `step()` in `src/physics.ts`; the results are written back onto the ball
// actors, the frame's cues play once per event through the world's audio bus,
// and every ball's trail records the frame against the game's own simulation
// clock (specs/state.md).
//
// What the rally does NOT do is score: judging the goals is the match rules'
// job, and the mode's tick runs after every actor's (src/match-mode.ts).

import { Actor } from "@clockwyrks/structured-2d";
import type { Ball } from "./ball";
import { CUES, SERVE_SPEED, TAGS } from "./constants";
import { ballsOf, obstaclesOf } from "./field";
import { Paddle } from "./paddle";
import { step } from "./physics";
import { gameOf, isSimulating } from "./state";
import type { Side } from "./sim";

export class Rally extends Actor {
  private paddles: { left: Paddle; right: Paddle } | null = null;

  beginPlay(): void {
    this.paddles = {
      left: this.sidePaddle(TAGS.paddleLeft, "left"),
      right: this.sidePaddle(TAGS.paddleRight, "right"),
    };
  }

  tick(dt: number): void {
    if (!isSimulating(this.world) || this.paddles === null) return;
    const game = gameOf(this.world);
    const balls = ballsOf(this.world);

    // 1. Every waiting ball counts its own hold down, and the ones that reach
    //    zero launch on this frame — so a ball launched here is advanced by
    //    the flight below on the same frame (specs/balls.md).
    for (const ball of balls) this.countHold(ball, dt);

    // 2. The flight, over the obstacles actually on the field.
    const { balls: advanced, events } = step(
      balls.map((ball) => ball.rally()),
      { cy: this.paddles.left.transform.y, vy: this.paddles.left.vy },
      { cy: this.paddles.right.transform.y, vy: this.paddles.right.vy },
      obstaclesOf(this.world).map((obstacle) => obstacle.rect()),
      dt,
    );
    balls.forEach((ball, index) => {
      if (!ball.held) ball.pose(advanced[index]);
    });

    // 3. One cue per event that actually happened, once per frame however many
    //    sub-steps or balls raised it (specs/audio.md). A ball-to-ball hit is
    //    ONE event between two balls: `events.ball` records the frame a pair
    //    met rather than the balls it happened to, so the cue plays once for
    //    the pair — playing it from a loop over the balls would sound the same
    //    contact twice, once for each side of it.
    if (events.paddle) this.world.audio.play(CUES.paddleHit);
    if (events.wall) this.world.audio.play(CUES.wallBounce);
    if (events.obstacle) this.world.audio.play(CUES.obstacleBounce);
    if (events.ball) this.world.audio.play(CUES.ballBounce);

    // 4. On every countdown or playing frame, after the balls have been
    //    advanced, each ball's position and the simulation time are appended to
    //    its own trail and the window is pruned (specs/state.md).
    for (const ball of balls) ball.record(game.simTime);
  }

  /**
   * One waiting ball's hold, and its launch.
   *
   * On the first frame the timer, after subtracting the frame's time, is at or
   * below zero the ball launches: the timer is spent, the trail cleared, the
   * spin zeroed, and it leaves at SERVE_SPEED along its own `launchAngle`,
   * drawn when it was parked or posed since and left as it is by the launch
   * (specs/balls.md).
   */
  private countHold(ball: Ball, dt: number): void {
    if (!ball.held) return;
    ball.holdTimer -= dt;
    if (ball.holdTimer > 0) return;

    const angle = ball.launchAngle;
    ball.holdTimer = 0;
    ball.held = false;
    ball.trail = [];
    ball.spin = 0;
    ball.vx = SERVE_SPEED * Math.cos(angle);
    ball.vy = SERVE_SPEED * Math.sin(angle);
  }

  private sidePaddle(tag: string, side: Side): Paddle {
    const found = this.world.byTag(tag)[0];
    if (!(found instanceof Paddle)) {
      throw new Error(`Carom: no ${side} paddle carries the "${tag}" tag`);
    }
    return found;
  }
}
