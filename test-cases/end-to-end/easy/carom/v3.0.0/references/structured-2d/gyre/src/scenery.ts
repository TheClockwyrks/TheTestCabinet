// Carom (Gyre) — the field furniture: the decorative net and the two LIVE
// obstacles.
//
// The net is placed by the level definitions (`src/levels.ts`) and never ticks:
// it is decoration with no collision (specs/playfield.md). The obstacles are
// placed by the game instance as it dresses each incoming world
// (`src/carry.ts`), because WHICH OBSTACLES ARE PRESENT IS STATE: `clearWorld`
// destroys them and `spawnObstacle(index)` places one back
// (specs/instrumentation.md), so an absent obstacle is not drawn and has no
// collision without a flag anywhere saying so.
//
// An obstacle holds no motion of its own. Its whole pose — center AND rotation
// — is a pure function of the match's obstacle clock (`src/obstacles.ts`), and
// `poseAt` writes that function's answer onto its transform. The transform is
// then the one pose everything reads: the oriented rectangle the collision
// resolves against (`src/ball.ts`), the pose `snapshot().obstacles` reports,
// and the pose the body below draws, so the picture and the collision cannot
// drift apart.
//
// WHO WINDS THE CLOCK. The match mode does, once per frame, AFTER every actor
// has ticked and so after the ball has taken every sub-step — which is what
// specs/playfield.md means by all of a frame's sub-steps facing one pose. It
// winds only on the live screens (the pre-serve countdown included, so the
// obstacles are already moving when the ball is served), holds still while the
// game is paused, and holds still while `setObstacleClockRunning(false)` has
// stopped it (specs/instrumentation.md).

import { Actor, DrawComponent } from "@clockwyrks/structured-2d";
import type { DrawApi } from "@clockwyrks/structured-2d";
import { FIELD_H, NET_X, OBSTACLE_HH, OBSTACLE_HW } from "./constants";
import { glowRect, type Ctx } from "./draw";
import { obstaclePose } from "./obstacles";
import type { ObstaclePose } from "./sim";
import { screenOf } from "./state";
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
