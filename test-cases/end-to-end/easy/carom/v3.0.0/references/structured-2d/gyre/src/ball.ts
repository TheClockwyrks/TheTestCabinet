// Carom — the ball: the one actor whose tick runs the match's physics.
//
// The actor carries the whole of the ball specs/state.md declares: its motion
// (`vx`, `vy`, `spin`; the position is its transform), its pre-serve hold
// (`held`, `holdTimer`), and its trail. WHETHER THE BALL IS PRESENT IS WHETHER
// THIS ACTOR IS IN THE WORLD — `clearWorld` destroys it and `spawnBall` places
// it (specs/instrumentation.md) — so an absent ball is not advanced, not drawn,
// collides with nothing, and scores no point without a flag anywhere saying so.
//
// Each `playing` frame it hands the whole flight to the pure `step()` in
// `src/physics.ts`: the spin's curve and decay, the sub-stepped integration,
// and every collision against the walls, the two paddles, and whichever
// obstacles are on the field, in the fixed order specs/balls.md states. The
// paddles and the obstacles are read from the world by their case-fixed tags,
// AFTER they have ticked — the ball is spawned last, and actors tick in spawn
// order — so a contact reads each paddle's integrated velocity for this frame,
// which is what drives the spin mechanic, and each obstacle's pose for the
// frame, which the mode winds once per frame AFTER every sub-step
// (specs/playfield.md).
//
// The cues the flight raised play here, one per event per frame, through the
// world's audio bus. What the ball does NOT do is count its own hold or score:
// judging a rally is the match rules' job, and the mode's tick runs after every
// actor's (src/match-mode.ts).

import { Actor, DrawComponent } from "@clockwyrks/structured-2d";
import type { DrawApi } from "@clockwyrks/structured-2d";
import { BALL_R, CUES, HOLD_TIME, TAGS } from "./constants";
import { glowCircle, type Ctx } from "./draw";
import { step } from "./physics";
import { drawServeSign } from "./random";
import { parkedBall, type BallSim } from "./sim";
import { Obstacle } from "./scenery";
import { caromState, screenOf } from "./state";
import { Paddle } from "./paddle";
import { COLOR, LAYER } from "./theme";
import { recordSample, ribbon, type TrailSample } from "./trail";

export class Ball extends Actor {
  vx = 0;
  vy = 0;
  /** The signed lateral-curvature scalar (specs/balls.md). */
  spin = 0;
  /** True while the ball waits at its home point rather than flying. */
  held = true;
  /** Seconds remaining of that wait. */
  holdTimer = HOLD_TIME;
  /**
   * The vertical sign the serve takes, drawn afresh whenever the ball is parked
   * and posed by the debug surface (specs/balls.md).
   */
  serveSign: 1 | -1 = drawServeSign();
  /** Recent positions, oldest first, for the motion trail. */
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

  /**
   * The arrangement `spawnBall` and a fresh countdown place the ball in: at its
   * home point, held, with a full hold, no motion, no spin, and no trail.
   */
  park(): void {
    this.pose(parkedBall());
    this.held = true;
    this.holdTimer = HOLD_TIME;
    this.trail = [];
    this.serveSign = drawServeSign();
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
    if (screen !== "playing" && screen !== "countdown") return;

    if (screen === "playing" && !this.held) {
      const left = this.paddle(TAGS.paddleLeft);
      const right = this.paddle(TAGS.paddleRight);
      const { ball, events } = step(
        this.sim(),
        { cy: left?.transform.y ?? 0, vy: left?.vy ?? 0 },
        { cy: right?.transform.y ?? 0, vy: right?.vy ?? 0 },
        // Whichever obstacles are on the field, at the pose the frame's clock
        // gave them. An absent obstacle is simply not in the list.
        this.world
          .byTag(TAGS.obstacle)
          .filter((actor): actor is Obstacle => actor instanceof Obstacle)
          .map((obstacle) => obstacle.pose()),
        dt,
      );
      this.pose(ball);
      // One cue per event that actually happened. A frame long enough to
      // contain two different kinds of bounce plays both, because each is its
      // own event and each has its own cue (specs/audio.md).
      if (events.paddle) this.world.audio.play(CUES.paddleHit);
      if (events.wall) this.world.audio.play(CUES.wallBounce);
      if (events.obstacle) this.world.audio.play(CUES.obstacleBounce);
    }

    // On every countdown or playing frame, after the ball has been advanced,
    // its position and the simulation time are appended to the trail and the
    // window is pruned (specs/state.md). Held at the center, the trail
    // collapses to nothing within TRAIL_TIME.
    this.trail = recordSample(this.trail, {
      x: this.transform.x,
      y: this.transform.y,
      t: caromState(this.world).game.simTime,
    });
  }

  /**
   * The tagged paddle, or null. Both paddles are always on the field
   * (specs/state.md), so the null is a guard against a half-built world rather
   * than a case the rules cover.
   */
  private paddle(tag: string): Paddle | null {
    const found = this.world.byTag(tag)[0];
    return found instanceof Paddle ? found : null;
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
