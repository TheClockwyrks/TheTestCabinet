// Carom — the field's furniture: the decorative net and the two obstacles.
//
// The net is decoration with no collision (specs/playfield.md) and is placed by
// the level. The OBSTACLES are not furniture in the same sense: which of them
// are present is declared state (specs/state.md), so each is an actor the debug
// surface's `clearWorld` destroys and `spawnObstacle(index)` puts back, and an
// absent one is simply not in the world — not drawn, and not among the
// rectangles the ball is resolved against.
//
// Each obstacle carries its `index` in the order of `OBSTACLE_CENTERS`, which
// is the index the snapshot reports it under and the index `spawnObstacle`
// names, and its transform sits on `OBSTACLE_CENTERS[index]`, which is where
// `world.byTag(TAGS.obstacle)` reports it. The collision geometry is the
// `OBSTACLES` rectangle of that same index, so the picture and the collision
// cannot drift apart.

import { Actor, DrawComponent } from "@test-cabinet/structured-2d";
import type { DrawApi, World } from "@test-cabinet/structured-2d";
import {
  FIELD_H,
  NET_X,
  OBSTACLE_CENTERS,
  OBSTACLE_HH,
  OBSTACLE_HW,
  TAGS,
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

/** One of the two fixed mid-field bars the ball banks off. */
export class Obstacle extends Actor {
  /** This obstacle's index in the order of `OBSTACLE_CENTERS`. */
  index = 0;

  constructor() {
    super();
    this.attach(new ObstacleBody()).layer = LAYER.obstacles;
  }

  /** Put the actor back on its fixed center, which is where it belongs. */
  place(): void {
    const center = OBSTACLE_CENTERS[this.index];
    this.transform.x = center.x;
    this.transform.y = center.y;
  }

  /** The axis-aligned rectangle the ball is resolved against. */
  rect(): Rect {
    return {
      x0: this.transform.x - OBSTACLE_HW,
      y0: this.transform.y - OBSTACLE_HH,
      x1: this.transform.x + OBSTACLE_HW,
      y1: this.transform.y + OBSTACLE_HH,
    };
  }
}

/** Every obstacle present on the field, in `OBSTACLE_CENTERS` order. */
export function obstaclesOf(world: World): Obstacle[] {
  return world
    .byTag(TAGS.obstacle)
    .filter((actor): actor is Obstacle => actor instanceof Obstacle)
    .sort((a, b) => a.index - b.index);
}

/** The rectangles the ball is resolved against, in that same order. */
export function obstacleRects(world: World): readonly Rect[] {
  return obstaclesOf(world).map((obstacle) => obstacle.rect());
}

/**
 * Place obstacle `index` at its fixed center: the one place an obstacle enters
 * the world. Spawning one that is already present returns it to that center,
 * which is the arrangement specs/instrumentation.md states.
 */
export function spawnObstacleActor(world: World, index: number): Obstacle {
  const existing = obstaclesOf(world).find(
    (obstacle) => obstacle.index === index,
  );
  if (existing !== undefined) {
    existing.place();
    return existing;
  }
  const center = OBSTACLE_CENTERS[index];
  return world.spawn(Obstacle, {
    transform: { x: center.x, y: center.y },
    tags: [TAGS.obstacle],
    configure: (obstacle: Obstacle) => {
      obstacle.index = index;
    },
  });
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
