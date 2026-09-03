// Carom — one of the three balls.
//
// The actor carries everything that is that ball's own (specs/state.md): its
// motion (`vx`, `vy`, `spin`; the position is its transform), its hold (`held`,
// `holdTimer`), its play-order `index` — which fixes its home point,
// `BALL_HOMES[index]` — and its trail. Every ball carries the one `TAGS.ball`
// tag, and `src/field.ts` reads them back in PLAY ORDER, by `index` rather than
// by spawn order, because `spawnBall` can put a ball back on a field the balls
// were cleared from and the order they were spawned in then says nothing.
//
// The ball itself does not tick. Its hold, its launch, and its flight are all
// the rally's (`src/rally.ts`), which runs them for every ball in one place:
// the balls advance in lock step and bounce off one another, and a ball whose
// hold elapses must be advanced on the same frame it launched on — neither is
// a computation one ball can do alone, and doing it here would tie the outcome
// to the order the balls happened to be spawned in.

import { Actor, DrawComponent } from "@test-cabinet/structured-2d";
import type { DrawApi } from "@test-cabinet/structured-2d";
import { BALL_R } from "./constants";
import { glowCircle, type Ctx } from "./draw";
import { parkedBall, type BallSim, type RallyBall } from "./sim";
import { screenOf } from "./state";
import { COLOR, LAYER } from "./theme";
import { recordSample, ribbon, type TrailSample } from "./trail";

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
  /** Seconds remaining of that wait. */
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
   * trail. `hold` is the wait it starts there: a positive hold leaves the ball
   * waiting and solid until that many seconds have passed, and `0` leaves it
   * parked and unheld.
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

  /**
   * Append this frame's position to the trail and prune the window
   * (specs/state.md). The rally calls it after the balls have been advanced,
   * with the game's own accumulated simulation time.
   */
  record(simTime: number): void {
    this.trail = recordSample(this.trail, {
      x: this.transform.x,
      y: this.transform.y,
      t: simTime,
    });
  }
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
