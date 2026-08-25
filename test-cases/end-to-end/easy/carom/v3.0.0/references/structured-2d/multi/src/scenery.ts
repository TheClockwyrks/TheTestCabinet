// Carom — the field's fixed furniture: the decorative net and the two
// obstacles.
//
// Both are placed by the level definitions (`src/levels.ts`) and never tick:
// the net is decoration with no collision (specs/playfield.md), and the
// obstacles are fixed bars whose collision geometry is the `OBSTACLES`
// rectangles in `src/constants.ts` — the same rectangles `src/physics.ts`
// resolves against, so the picture and the collision cannot drift apart. Each
// obstacle actor's transform sits on its center from `OBSTACLE_CENTERS`, which
// is where `world.byTag(TAGS.obstacle)` reports it.

import { Actor, DrawComponent } from "@test-cabinet/structured-2d";
import type { DrawApi } from "@test-cabinet/structured-2d";
import {
  FIELD_H,
  NET_X,
  OBSTACLE_HH,
  OBSTACLE_HW,
  type Point,
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

/** One of the two fixed mid-field bars the ball banks off. */
export class Obstacle extends Actor {
  constructor() {
    super();
    this.attach(new ObstacleBody()).layer = LAYER.obstacles;
  }

  /** Place the actor on its fixed center. */
  placeAt(center: Point): void {
    this.transform.x = center.x;
    this.transform.y = center.y;
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
