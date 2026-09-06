// Carom — the ball: the one actor whose tick runs the match's physics.
//
// The actor carries everything specs/state.md says the ball carries — its
// motion (`vx`, `vy`, `spin`; the position is its transform), whether it is
// held and for how much longer, and its trail — and each `playing` frame it
// hands the whole flight to the pure `step()` in `src/physics.ts`: the spin's
// curve and decay, the sub-stepped integration, and every collision against the
// walls, the two paddles, and the obstacles PRESENT ON THE FIELD, in the fixed
// order specs/balls.md states. The paddles are read from the world by their
// case-fixed tags, AFTER they have ticked — the mode spawns the ball last, and
// actors tick in spawn order — so a contact reads each paddle's integrated
// velocity for this frame, which is what drives the spin mechanic.
//
// WHETHER THE BALL IS PRESENT IS STATE (specs/state.md), so the ball is an
// actor the debug surface's `clearWorld` destroys and `spawnBall` puts back:
// an absent ball is simply an actor that is not in the world, which is what
// makes "not advanced, not drawn, collides with nothing, scores no point" fall
// out of the framework rather than out of a flag every rule has to remember.
//
// The cues the flight raised play here, one per event per frame, through the
// world's audio bus. What the ball does NOT do is score, or serve itself:
// judging a rally and launching a serve are the match rules' job, and the
// mode's tick runs after every actor's (`src/carom-mode.ts`).

import { Actor, DrawComponent } from "@clockwyrks/structured-2d";
import type { DrawApi, World } from "@clockwyrks/structured-2d";
import {
  BALL_R,
  CUES,
  FIELD_CX,
  FIELD_CY,
  HOLD_TIME,
  TAGS,
  type Rect,
} from "./constants";
import { glowCircle, type Ctx } from "./draw";
import { step } from "./physics";
import { obstacleRects } from "./scenery";
import { drawServeSign } from "./random";
import { parkedBall, type BallSim, type Side } from "./sim";
import { caromState, type Screen } from "./state";
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
   * Park at the field center, motionless and spinless, with no trail and a
   * fresh serve sign.
   */
  park(): void {
    this.pose(parkedBall());
    this.trail = [];
    this.serveSign = drawServeSign();
  }

  /**
   * The arrangement `spawnBall` and a fresh match both put the ball in
   * (specs/instrumentation.md, specs/ui.md): at its home point, held, with a
   * full hold, zero velocity, zero spin, and an empty trail.
   */
  home(): void {
    this.park();
    this.held = true;
    this.holdTimer = HOLD_TIME;
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
    const state = caromState(this.world);
    const screen = state.screen;

    if (screen === "countdown") {
      // Every countdown frame subtracts dt from the hold; the mode's own tick,
      // which runs after every actor's, serves on the first frame the result
      // is <= 0 (specs/balls.md).
      this.holdTimer -= dt;
    } else if (screen === "playing" && !this.held) {
      this.advance(dt);
    }

    // On every countdown or playing frame, after the ball has been advanced,
    // its position and the simulation time are appended to the trail and the
    // window is pruned (specs/state.md). Held at the center, the trail
    // collapses to nothing within TRAIL_TIME.
    if (screen === "countdown" || screen === "playing") {
      this.trail = recordSample(this.trail, {
        x: this.transform.x,
        y: this.transform.y,
        t: state.game.simTime,
      });
    }
  }

  /** One frame of real flight, with every cue the collisions raised. */
  private advance(dt: number): void {
    const left = this.sidePaddle("left");
    const right = this.sidePaddle("right");
    if (left === null || right === null) return;

    const { ball, events } = step(
      this.sim(),
      { cy: left.transform.y, vy: left.vy },
      { cy: right.transform.y, vy: right.vy },
      this.obstacles(),
      dt,
    );
    this.pose(ball);
    // One cue per event that actually happened. A frame long enough to contain
    // two different kinds of bounce plays both, because each is its own event
    // and each has its own cue (specs/audio.md).
    if (events.paddle) this.world.audio.play(CUES.paddleHit);
    if (events.wall) this.world.audio.play(CUES.wallBounce);
    if (events.obstacle) this.world.audio.play(CUES.obstacleBounce);
  }

  /** The rectangles of the obstacles PRESENT on the field, in index order. */
  private obstacles(): readonly Rect[] {
    return obstacleRects(this.world);
  }

  private sidePaddle(side: Side): Paddle | null {
    const tag = side === "left" ? TAGS.paddleLeft : TAGS.paddleRight;
    const found = this.world.byTag(tag)[0];
    return found instanceof Paddle ? found : null;
  }
}

/** The one ball on the field, or `null` while none is present. */
export function ballOf(world: World): Ball | null {
  const found = world.byTag(TAGS.ball)[0];
  return found instanceof Ball ? found : null;
}

/**
 * Place a ball at its home point, in the arrangement `spawnBall` fixes.
 *
 * Spawning is what "the ball is present" MEANS here, so this is the one place
 * a ball enters the world: the mode opens a match with it and the debug
 * surface's `spawnBall` calls it again.
 */
export function spawnBallActor(world: World): Ball {
  const ball = world.spawn(Ball, {
    transform: { x: FIELD_CX, y: FIELD_CY },
    tags: [TAGS.ball],
  });
  ball.home();
  return ball;
}

/** True on the screens the ball itself is part of the picture. */
function ballVisible(screen: Screen): boolean {
  return screen === "countdown" || screen === "playing" || screen === "paused";
}

/** The glowing disc. On the menu screens the ball is out of the picture. */
class BallBody extends DrawComponent {
  draw(api: DrawApi): void {
    const ball = this.actor as Ball;
    if (!ballVisible(caromState(ball.world).screen)) return;
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
    if (!ballVisible(caromState(ball.world).screen)) return;

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
