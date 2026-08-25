// Carom — one of the three balls.
//
// The actor carries everything that is that ball's own (specs/balls.md): its
// motion (`vx`, `vy`, `spin`; the position is its transform), its hold
// (`held`, `holdTimer`), its play-order `index` — which fixes its home point,
// `BALL_HOMES[index]` — and its trail. The three balls are spawned in play
// order under the one `TAGS.ball` tag, so `world.byTag` lists them by index,
// which is the order `setBall` and `snapshot.balls` address them in.
//
// What the ball's own tick runs is its HOLD alone: on every live frame a
// waiting ball counts its own timer down, and on the first frame the timer has
// elapsed it launches itself — at SERVE_SPEED, along a fresh angle drawn from
// the game's seeded generator. The flight itself is collective: the balls
// advance in lock step and bounce off one another, so the frame's physics runs
// in the `Rally` actor (`src/rally.ts`), which the mode spawns after them. A
// ball launched on a frame is therefore advanced on that same frame, exactly
// as specs/balls.md asks.

import { Actor, DrawComponent } from "@test-cabinet/structured-2d";
import type { DrawApi } from "@test-cabinet/structured-2d";
import { BALL_R, SERVE_SPEED, TAGS } from "./constants";
import { glowCircle, type Ctx } from "./draw";
import { parkedBall, type BallSim, type RallyBall } from "./sim";
import { isLiveScreen, MatchState, screenOf } from "./state";
import { COLOR, LAYER } from "./theme";
import { recordSample, ribbon, type TrailSample } from "./trail";
import type { World } from "@test-cabinet/structured-2d";

export class Ball extends Actor {
  /** This ball's place in play order: its home is `BALL_HOMES[index]`. */
  index = 0;

  vx = 0;
  vy = 0;
  /** The signed lateral-curvature scalar (specs/balls.md). */
  spin = 0;
  /**
   * True while the ball waits at its home point rather than flying. A waiting
   * ball is motionless and SOLID: another ball that reaches it bounces off,
   * and it launches when its own hold timer elapses and at no other moment.
   */
  held = false;
  /**
   * Seconds remaining of that wait. HOLD_TIME when the ball takes its home
   * point, counting down to 0, at which point it launches; 0 while it is in
   * flight — and on the title level, where the parked balls are furniture.
   */
  holdTimer = 0;
  /** Recent positions, oldest first, for this ball's own motion trail. */
  trail: readonly TrailSample[] = [];

  constructor() {
    super();
    this.attach(new TrailStreak()).layer = LAYER.trail;
    this.attach(new BallBody()).layer = LAYER.ball;
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

  /** The ball as the frame's collective step reads it. */
  rally(): RallyBall {
    return { ...this.sim(), held: this.held };
  }

  /**
   * Park at this ball's own home point, motionless and spinless, with no
   * trail. `hold` is the wait it starts there: a positive hold leaves the
   * ball waiting and solid until that many seconds have passed, and `0`
   * leaves it parked and unheld — the title screen's pose, no part of a live
   * match.
   */
  park(hold: number): void {
    this.pose(parkedBall(this.index));
    this.held = hold > 0;
    this.holdTimer = hold;
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

  /** Take the ball into live play, as `setBall` on the debug surface does. */
  release(): void {
    this.held = false;
    this.holdTimer = 0;
  }

  /**
   * This ball's own hold, and nothing else: every live frame subtracts `dt`,
   * and on the first frame the result is `<= 0` the ball launches — timer
   * spent, spin zero, trail cleared, off at SERVE_SPEED along a fresh angle
   * from the seeded generator. The flight that follows is the `Rally` actor's,
   * which ticks after every ball, so the launch is advanced this same frame.
   */
  tick(dt: number): void {
    if (!this.held) return;
    if (!isLiveScreen(screenOf(this.world))) return;

    this.holdTimer -= dt;
    if (this.holdTimer > 0) return;
    this.holdTimer = 0;

    const state = this.world.state;
    if (!(state instanceof MatchState)) return;
    const angle = state.game.drawLaunchAngle();
    this.held = false;
    this.trail = [];
    this.spin = 0;
    this.vx = SERVE_SPEED * Math.cos(angle);
    this.vy = SERVE_SPEED * Math.sin(angle);
  }

  /**
   * Append this frame's position to the trail and prune the window
   * (specs/state.md). Called by the `Rally` actor after the balls have been
   * advanced; parked at home, the trail collapses to nothing within
   * TRAIL_TIME.
   */
  record(): void {
    this.trail = recordSample(this.trail, {
      x: this.transform.x,
      y: this.transform.y,
      t: this.world.frame().timeMs / 1000,
    });
  }
}

/** The three tagged balls, in play order — the order they were spawned in. */
export function ballsOf(world: World): Ball[] {
  const found = world.byTag(TAGS.ball);
  const balls: Ball[] = [];
  for (const actor of found) {
    if (!(actor instanceof Ball)) {
      throw new Error(`Carom: a non-ball actor carries the "${TAGS.ball}" tag`);
    }
    balls.push(actor);
  }
  return balls;
}

/** The ball at `index` in play order. */
export function ballAt(world: World, index: number): Ball {
  const ball = ballsOf(world)[index];
  if (ball === undefined) {
    throw new Error(`Carom: no ball carries play-order index ${index}`);
  }
  return ball;
}

/** True on the screens the balls themselves are part of the picture. */
function ballVisible(screen: ReturnType<typeof screenOf>): boolean {
  return screen === "countdown" || screen === "playing" || screen === "paused";
}

/** The glowing disc. On the menu screens the balls are out of the picture. */
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
 * A ball's motion trail: a single tapering, fading comet following that
 * ball's recent (curving) path. It is built as one filled ribbon whose
 * half-width tapers to zero at the oldest end, filled with a head-to-tail
 * gradient so it reads as a smooth streak rather than as discrete dots. Its
 * length is proportional to that ball's speed, because the samples span a
 * fixed slice of time, and it curves where the flight curved.
 */
class TrailStreak extends DrawComponent {
  draw(api: DrawApi): void {
    const ball = this.actor as Ball;
    if (!ballVisible(screenOf(ball.world))) return;

    // Newest first, and the newest sample IS where the ball is: the rally
    // records every ball's position at the end of every live frame, and the
    // frame the engine draws is the frame it just stepped.
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
