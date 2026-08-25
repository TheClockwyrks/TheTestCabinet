// Carom (Gyre) — the field furniture: the decorative net and the two LIVE
// obstacles.
//
// Both are placed by the level definitions (`src/levels.ts`). The net never
// ticks: it is decoration with no collision (specs/playfield.md). The
// obstacles sway and rotate, and their whole motion is a pure function of the
// match's obstacle clock (`src/obstacles.ts`): each frame every obstacle
// REPOSES its transform from the clock rather than integrating anything, so a
// posed clock and a match that has been running that long face the identical
// field. The transform — position AND rotation — is the live pose the
// oriented collision resolves against (`src/ball.ts` reads it), the pose
// `snapshot().obstacles` reports, and the pose the body below draws, so the
// picture and the collision cannot drift apart.
//
// WHO WINDS THE CLOCK. The clock is one figure shared by the pair, kept on the
// match's game state (`src/state.ts`), and advanced exactly once per frame: by
// obstacle A (index 0), which ticks first — the level spawns the obstacles in
// `OBSTACLE_CENTERS` order and actors tick in spawn order — so by the time B
// poses, and later the ball resolves its flight, both read the frame's settled
// clock. It advances only on the live screens (the pre-serve countdown
// included, so the obstacles are already moving when the ball is served),
// freezes while the game is paused, and is held still while the debug driver
// holds the paddles (specs/instrumentation.md). In the title level's world
// there is no match state and no clock: the obstacles stand upright on their
// base centers, exactly the clock-zero pose a match opens with.

import { Actor, DrawComponent } from "@test-cabinet/structured-2d";
import type { DrawApi } from "@test-cabinet/structured-2d";
import { FIELD_H, NET_X, OBSTACLE_HH, OBSTACLE_HW } from "./constants";
import { glowRect, type Ctx } from "./draw";
import { obstaclePose } from "./obstacles";
import type { ObstaclePose } from "./sim";
import { isLiveScreen, MatchState, screenOf } from "./state";
import { COLOR, FURNITURE_ALPHA, LAYER } from "./theme";

/** The dashed center net, drawn at `NET_X`. Decoration only: no collision. */
export class Net extends Actor {
  constructor() {
    super();
    this.attach(new NetDashes()).layer = LAYER.net;
  }
}

class NetDashes extends DrawComponent {
  draw(api: DrawApi): void {
    if (api.mode === "silhouette") return;
    const ctx = api.ctx as Ctx;
    ctx.save();
    ctx.globalAlpha = FURNITURE_ALPHA[screenOf(this.actor.world)];
    ctx.fillStyle = COLOR.net;
    const x = NET_X - 2;
    for (let y = 24; y < FIELD_H - 24; y += 30) {
      if (api.mode === "wireframe") {
        ctx.strokeStyle = COLOR.net;
        ctx.strokeRect(x, y, 4, 16);
      } else {
        ctx.fillRect(x, y, 4, 16);
      }
    }
    ctx.restore();
  }
}

/** One of the two swaying, spinning mid-field bars the ball banks off. */
export class Obstacle extends Actor {
  /** Which of `OBSTACLE_CENTERS` this bar is: 0 is A, 1 is B. */
  index = 0;

  constructor() {
    super();
    this.attach(new ObstacleBody()).layer = LAYER.obstacles;
  }

  tick(dt: number): void {
    const state = this.world.state;
    // The title level has no clock: its obstacles stand in the upright,
    // clock-zero pose the level placed them in.
    if (!(state instanceof MatchState)) return;

    // Obstacle A winds the shared clock, once, for the pair. Held still while
    // the debug driver holds the paddles, so a posed scenario faces the
    // orientation it chose (specs/instrumentation.md).
    if (
      this.index === 0 &&
      isLiveScreen(state.screen) &&
      !state.game.driver.holding
    ) {
      state.obstacleClock += dt;
    }
    this.poseAt(state.obstacleClock);
  }

  /** Repose the transform — center and rotation — from the clock. */
  poseAt(t: number): void {
    const pose = obstaclePose(this.index, t);
    this.transform.x = pose.cx;
    this.transform.y = pose.cy;
    this.transform.rotation = pose.theta;
  }

  /** The live pose, as the oriented collision and the snapshot read it. */
  pose(): ObstaclePose {
    return {
      cx: this.transform.x,
      cy: this.transform.y,
      theta: this.transform.rotation,
    };
  }
}

/**
 * The glowing bar, drawn in the obstacle's OWN frame — translate to its live
 * center, rotate by its live angle, then draw the bar about the origin — so
 * what the player sees is the same oriented rectangle the collision resolves
 * against, rather than an upright bar that happens to sit in the same place.
 */
class ObstacleBody extends DrawComponent {
  draw(api: DrawApi): void {
    const ctx = api.ctx as Ctx;
    const at = this.worldTransform();
    ctx.save();
    ctx.globalAlpha = FURNITURE_ALPHA[screenOf(this.actor.world)];
    ctx.translate(at.x, at.y);
    ctx.rotate(at.rotation);
    glowRect(
      ctx,
      api.mode,
      -OBSTACLE_HW,
      -OBSTACLE_HH,
      OBSTACLE_HW * 2,
      OBSTACLE_HH * 2,
      6,
      COLOR.obstacle,
      "rgba(255, 180, 84, 0.5)",
      16,
    );
    ctx.restore();
  }
}
