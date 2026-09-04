// Carom — the field's fixed furniture: the decorative net and the two
// obstacles.
//
// The net is decoration with no collision (specs/playfield.md) and is placed by
// each level definition. The obstacles are PRESENCE STATE (specs/state.md):
// which of them is on the field is something `clearWorld` and `spawnObstacle`
// change, so they are spawned rather than declared, each carrying its index in
// the order of `OBSTACLE_CENTERS` and sitting on that centre. Their collision
// geometry is the `OBSTACLES` rectangles in `src/constants.ts`, the same
// rectangles `src/physics.ts` resolves against, so the picture and the
// collision cannot drift apart.

import { Actor, DrawComponent } from "@test-cabinet/structured-2d";
import type { DrawApi } from "@test-cabinet/structured-2d";
import {
  FIELD_H,
  NET_X,
  OBSTACLE_HH,
  OBSTACLE_HW,
  OBSTACLES,
  type Rect,
} from "./constants";
import { glowRect, type Ctx } from "./draw";
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

/** One of the two fixed mid-field bars the balls bank off. */
export class Obstacle extends Actor {
  /** This obstacle's place in the order of `OBSTACLE_CENTERS`. */
  index = 0;

  constructor() {
    super();
    this.attach(new ObstacleBody()).layer = LAYER.obstacles;
  }

  /** The rectangle the collision resolves this obstacle against. */
  rect(): Rect {
    return OBSTACLES[this.index];
  }
}

class ObstacleBody extends DrawComponent {
  draw(api: DrawApi): void {
    const ctx = api.ctx as Ctx;
    const at = this.worldTransform();
    ctx.save();
    ctx.globalAlpha = FURNITURE_ALPHA[screenOf(this.actor.world)];
    glowRect(
      ctx,
      api.mode,
      at.x - OBSTACLE_HW,
      at.y - OBSTACLE_HH,
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
