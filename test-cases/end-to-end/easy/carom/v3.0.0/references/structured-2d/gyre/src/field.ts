// Carom — finding, placing, and removing the field's bodies.
//
// specs/state.md puts the field's bodies on the ACTORS and makes their presence
// state: whether a ball or an obstacle is on the field is whether its actor is
// in the world, which `clearWorld`, `spawnBall`, and `spawnObstacle` decide
// (specs/instrumentation.md). This module is the one place that fact is acted
// on, so the debug surface, the world the instance dresses after a level
// transition, and the match rules all place and find them the same way.
//
// Every body carries its case-fixed tag from `TAGS` (specs/state.md), so
// `world.byTag` finds it under the name the specification uses. The ball is
// spawned LAST, after the paddles and the obstacles, because actors tick in
// spawn order and a contact has to read each paddle's integrated velocity for
// the frame (src/ball.ts).

import type { World } from "@test-cabinet/structured-2d";
import { Ball } from "./ball";
import { OBSTACLE_CENTERS, TAGS } from "./constants";
import { Paddle } from "./paddle";
import { Obstacle } from "./scenery";
import type { Side } from "./sim";

/** The side's tagged paddle, or null while the world is still being built. */
export function paddleOf(world: World, side: Side): Paddle | null {
  const tag = side === "left" ? TAGS.paddleLeft : TAGS.paddleRight;
  const found = world.byTag(tag)[0];
  return found instanceof Paddle ? found : null;
}

/** The ball on the field, or null while none is present. */
export function ballOf(world: World): Ball | null {
  const found = world.byTag(TAGS.ball)[0];
  return found instanceof Ball ? found : null;
}

/** The obstacles on the field, in `OBSTACLE_CENTERS` order. */
export function obstaclesOf(world: World): Obstacle[] {
  return world
    .byTag(TAGS.obstacle)
    .filter((actor): actor is Obstacle => actor instanceof Obstacle)
    .sort((a, b) => a.index - b.index);
}

/** Obstacle `index`, or null while it is not on the field. */
export function obstacleOf(world: World, index: number): Obstacle | null {
  return obstaclesOf(world).find((o) => o.index === index) ?? null;
}

/** Whether `index` names one of the two obstacles `OBSTACLE_CENTERS` fixes. */
export function isObstacleIndex(index: number): boolean {
  return (
    Number.isInteger(index) && index >= 0 && index < OBSTACLE_CENTERS.length
  );
}

/**
 * Place the ball at its home point, held, with a full hold, no motion, no spin,
 * and no trail — spawning it when the field has none, and returning the one
 * already there to that same arrangement when it has
 * (specs/instrumentation.md).
 */
export function placeBall(world: World): Ball {
  const existing = ballOf(world);
  const ball = existing ?? world.spawn(Ball, { tags: [TAGS.ball] });
  ball.park();
  return ball;
}

/**
 * Place obstacle `index` in the pose the clock `t` gives it — spawning it when
 * it is off the field, and reposing the one already there when it is not.
 */
export function placeObstacle(
  world: World,
  index: number,
  t: number,
): Obstacle {
  const existing = obstacleOf(world, index);
  const obstacle =
    existing ??
    world.spawn(Obstacle, {
      tags: [TAGS.obstacle],
      configure: (actor: Obstacle) => {
        actor.index = index;
      },
    });
  obstacle.poseAt(t);
  return obstacle;
}

/** Repose every obstacle on the field from the obstacle clock `t`. */
export function poseObstacles(world: World, t: number): void {
  for (const obstacle of obstaclesOf(world)) obstacle.poseAt(t);
}

/** Remove the ball and every obstacle, leaving the paddles where they are. */
export function clearField(world: World): void {
  ballOf(world)?.destroy();
  for (const obstacle of obstaclesOf(world)) obstacle.destroy();
}
