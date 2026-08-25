// Carom — the rally: the one actor whose tick runs the frame's collective
// physics.
//
// The three balls do not fly one at a time: specs/balls.md advances the balls
// in flight TOGETHER, in sub-steps sized by the fastest of them, and resolves
// every pair in contact at the end of each sub-step. That is a computation
// over the whole set, so it lives in one place — this actor — rather than in
// each ball's own tick, which runs only that ball's hold (`src/ball.ts`).
//
// The mode spawns the rally LAST, after both paddles and all three balls, and
// actors tick in spawn order: by the time this tick runs, the paddles carry
// their integrated velocities for the frame — which is what the spin mechanic
// reads at contact — and every ball whose hold elapsed this frame has
// launched, so it is advanced on that same frame. The whole flight is handed
// to the pure `step()` in `src/physics.ts`; the results are written back onto
// the ball actors, the frame's cues play once per event through the world's
// audio bus, and every ball's trail records the frame (specs/state.md).
//
// What the rally does NOT do is score: judging the goals is the match rules'
// job, and the mode's tick runs after every actor's (src/match-mode.ts).

import { Actor } from "@test-cabinet/structured-2d";
import { ballsOf } from "./ball";
import { CUES, OBSTACLES, TAGS } from "./constants";
import { Paddle } from "./paddle";
import { step } from "./physics";
import { isLiveScreen, screenOf } from "./state";
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
    if (!isLiveScreen(screenOf(this.world)) || this.paddles === null) return;
    const balls = ballsOf(this.world);

    const { balls: advanced, events } = step(
      balls.map((ball) => ball.rally()),
      { cy: this.paddles.left.transform.y, vy: this.paddles.left.vy },
      { cy: this.paddles.right.transform.y, vy: this.paddles.right.vy },
      OBSTACLES,
      dt,
    );
    balls.forEach((ball, index) => {
      if (!ball.held) ball.pose(advanced[index]);
    });

    // One cue per event that actually happened, once per frame however many
    // sub-steps or balls raised it (specs/ui.md). A ball-to-ball hit is ONE
    // event between two balls: `events.ball` records the frame a pair met
    // rather than the balls it happened to, so the cue plays once for the
    // pair — playing it from a loop over the balls would sound the same
    // contact twice, once for each side of it.
    if (events.paddle) this.world.audio.play(CUES.paddleHit);
    if (events.wall) this.world.audio.play(CUES.wallBounce);
    if (events.obstacle) this.world.audio.play(CUES.obstacleBounce);
    if (events.ball) this.world.audio.play(CUES.ballBounce);

    // On every countdown or playing frame, after the balls have been
    // advanced, each ball's position and the simulation time are appended to
    // its own trail and the window is pruned (specs/state.md).
    for (const ball of balls) ball.record();
  }

  private sidePaddle(tag: string, side: Side): Paddle {
    const found = this.world.byTag(tag)[0];
    if (!(found instanceof Paddle)) {
      throw new Error(`Carom: no ${side} paddle carries the "${tag}" tag`);
    }
    return found;
  }
}
