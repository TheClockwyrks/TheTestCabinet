// Carom — the ball: the one actor whose tick runs the match's physics.
//
// The actor carries the ball's motion (`vx`, `vy`, `spin`; the position is its
// transform) and its trail, and each `playing` frame it hands the whole flight
// to the pure `step()` in `src/physics.ts`: the spin's curve and decay, the
// sub-stepped integration, and every collision against the walls, the two
// paddles, and the two obstacles, in the fixed order specs/balls.md states.
// The paddles and the obstacles are read from the world by their case-fixed
// tags, AFTER they have ticked — the mode spawns the ball last, and actors
// tick in spawn order — so a contact reads each paddle's integrated velocity
// for this frame, which is what drives the spin mechanic, and each obstacle's
// live pose for this frame, which is the oriented rectangle the flight
// resolves against (specs/playfield.md).
//
// The cues the flight raised play here, one per event per frame, through the
// world's audio bus. What the ball does NOT do is score: judging a rally is
// the match rules' job, and the mode's tick runs after every actor's
// (src/match-mode.ts).

import { Actor, DrawComponent } from "@test-cabinet/structured-2d";
import type { DrawApi } from "@test-cabinet/structured-2d";
import { BALL_R, CUES, TAGS } from "./constants";
import { glowCircle, type Ctx } from "./draw";
import { step } from "./physics";
import { parkedBall, type BallSim, type Side } from "./sim";
import { Obstacle } from "./scenery";
import { screenOf } from "./state";
import { Paddle } from "./paddle";
import { COLOR, LAYER } from "./theme";
import { recordSample, ribbon, type TrailSample } from "./trail";

export class Ball extends Actor {
  vx = 0;
  vy = 0;
  /** The signed lateral-curvature scalar (specs/balls.md). */
  spin = 0;
  /** Recent positions, oldest first, for the motion trail. */
  trail: readonly TrailSample[] = [];

  private paddles: { left: Paddle; right: Paddle } | null = null;
  /** The two obstacle actors, in `OBSTACLE_CENTERS` order (A then B). */
  private obstacles: readonly Obstacle[] = [];

  constructor() {
    super();
    this.attach(new TrailStreak()).layer = LAYER.trail;
    this.attach(new BallBody()).layer = LAYER.ball;
  }

  beginPlay(): void {
    this.paddles = {
      left: this.sidePaddle(TAGS.paddleLeft, "left"),
      right: this.sidePaddle(TAGS.paddleRight, "right"),
    };
    // `byTag` reports in spawn order, which is A then B (src/levels.ts) — the
    // fixed order the collision resolves the pair in (specs/balls.md).
    this.obstacles = this.world
      .byTag(TAGS.obstacle)
      .filter((actor): actor is Obstacle => actor instanceof Obstacle);
  }

  /** The ball's motion as the physics reads it. */
  sim(): BallSim {
    return {
      x: this.transform.x,
      y: this.transform.y,
      vx: this.vx,
      vy: this.vy,
      spin: this.spin,
    };
  }

  /** Park at the field center, motionless and spinless, with no trail. */
  park(): void {
    this.pose(parkedBall());
    this.trail = [];
  }

  /** Write a computed motion back onto the actor. */
  pose(sim: BallSim): void {
    this.transform.x = sim.x;
    this.transform.y = sim.y;
    this.vx = sim.vx;
    this.vy = sim.vy;
    this.spin = sim.spin;
  }

  tick(dt: number): void {
    const screen = screenOf(this.world);

    if (screen === "playing" && this.paddles !== null) {
      const { ball, events } = step(
        this.sim(),
        { cy: this.paddles.left.transform.y, vy: this.paddles.left.vy },
        { cy: this.paddles.right.transform.y, vy: this.paddles.right.vy },
        // The obstacles' LIVE poses: they ticked before this actor, so these
        // are this frame's settled centers and angles.
        this.obstacles.map((obstacle) => obstacle.pose()),
        dt,
      );
      this.pose(ball);
      // One cue per event that actually happened. A frame long enough to
      // contain two different kinds of bounce plays both, because each is its
      // own event and each has its own cue (specs/ui.md).
      if (events.paddle) this.world.audio.play(CUES.paddleHit);
      if (events.wall) this.world.audio.play(CUES.wallBounce);
      if (events.obstacle) this.world.audio.play(CUES.obstacleBounce);
    }

    // On every countdown or playing frame, after the ball has been advanced,
    // its position and the simulation time are appended to the trail and the
    // window is pruned (specs/state.md). Held at the center, the trail
    // collapses to nothing within TRAIL_TIME.
    if (screen === "playing" || screen === "countdown") {
      this.trail = recordSample(this.trail, {
        x: this.transform.x,
        y: this.transform.y,
        t: this.world.frame().timeMs / 1000,
      });
    }
  }

  private sidePaddle(tag: string, side: Side): Paddle {
    const found = this.world.byTag(tag)[0];
    if (!(found instanceof Paddle)) {
      throw new Error(`Carom: no ${side} paddle carries the "${tag}" tag`);
    }
    return found;
  }
}

/** True on the screens the ball itself is part of the picture. */
function ballVisible(screen: ReturnType<typeof screenOf>): boolean {
  return screen === "countdown" || screen === "playing" || screen === "paused";
}

/** The glowing disc. On the menu screens the ball is out of the picture. */
class BallBody extends DrawComponent {
  draw(api: DrawApi): void {
    const ball = this.actor as Ball;
    if (!ballVisible(screenOf(ball.world))) return;
    glowCircle(
      api.ctx as Ctx,
      api.mode,
      ball.transform.x,
      ball.transform.y,
      BALL_R,
      COLOR.ball,
      "rgba(242, 245, 247, 0.8)",
      16,
    );
  }
}

/**
 * The motion trail: a single tapering, fading comet following the ball's
 * recent (curving) path. It is built as one filled ribbon whose half-width
 * tapers to zero at the oldest end, filled with a head-to-tail gradient so it
 * reads as a smooth streak rather than as discrete dots. Its length is
 * proportional to the ball's speed, because the samples span a fixed slice of
 * time, and it curves where the flight curved.
 */
class TrailStreak extends DrawComponent {
  draw(api: DrawApi): void {
    const ball = this.actor as Ball;
    if (!ballVisible(screenOf(ball.world))) return;

    // Newest first, and the newest sample IS where the ball is: the tick
    // records the ball's position at the end of every frame, and the frame the
    // engine draws is the frame it just stepped.
    const pts = ribbon(ball.trail);
    if (pts.length < 2) return;

    const head = pts[0];
    const tail = pts[pts.length - 1];
    if (Math.hypot(head.x - tail.x, head.y - tail.y) < 3) return; // collapsed

    const n = pts.length;
    const headHalf = 8;
    const left: { x: number; y: number }[] = [];
    const right: { x: number; y: number }[] = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const prev = pts[Math.max(i - 1, 0)];
      const next = pts[Math.min(i + 1, n - 1)];
      let tx = next.x - prev.x;
      let ty = next.y - prev.y;
      const len = Math.hypot(tx, ty) || 1;
      tx /= len;
      ty /= len;
      // Perpendicular to the local tangent.
      const nx = -ty;
      const ny = tx;
      const f = i / (n - 1); // 0 at the head, 1 at the tail
      const hw = headHalf * (1 - f);
      left.push({ x: p.x + nx * hw, y: p.y + ny * hw });
      right.push({ x: p.x - nx * hw, y: p.y - ny * hw });
    }

    const ctx = api.ctx as Ctx;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(left[0].x, left[0].y);
    for (let i = 1; i < n; i++) ctx.lineTo(left[i].x, left[i].y);
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
    ctx.closePath();

    if (api.mode === "wireframe") {
      ctx.lineWidth = 1;
      ctx.strokeStyle = COLOR.textFaint;
      ctx.stroke();
      ctx.restore();
      return;
    }

    const grad = ctx.createLinearGradient(head.x, head.y, tail.x, tail.y);
    grad.addColorStop(0, "rgba(242, 245, 247, 0.55)");
    grad.addColorStop(0.55, "rgba(242, 245, 247, 0.18)");
    grad.addColorStop(1, "rgba(242, 245, 247, 0)");
    ctx.fillStyle = grad;
    if (api.mode === "shaded") {
      ctx.shadowColor = "rgba(242, 245, 247, 0.35)";
      ctx.shadowBlur = 8;
    }
    ctx.fill();
    ctx.restore();
  }
}
