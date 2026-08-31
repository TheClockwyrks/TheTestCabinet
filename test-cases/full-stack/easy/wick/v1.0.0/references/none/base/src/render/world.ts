// Wick — the world under the camera (specs/world.md "The camera and the
// view", specs/assets.md "The sprites", "Animation").
//
// Every world point is drawn at `(wx − player.x + STAGE_CX, wy − player.y +
// STAGE_CY)`, so the lamplighter sits at the stage center and the ground
// pattern, fixed in world space, slides beneath it. A produced sprite is
// drawn at one unit per pixel where it decoded; where it did not, a
// code-drawn stand-in of the same size takes its place.

import type { Assets } from "../assets";
import {
  ASSET_PATHS,
  ENEMIES,
  ENEMY_WALK_FRAMES,
  GEM_SIZES,
  GROUND_TILE,
  LAMPLIGHTER_SIZE,
  LAMPLIGHTER_WALK_FRAMES,
  PICKUP_SIZE,
  PLAYER_RADIUS,
  PUFF_FRAMES,
  PUFF_TIME,
  STAGE_CX,
  STAGE_CY,
  STAGE_H,
  STAGE_W,
  TICK_DT,
  WALK_FRAME_TIME,
} from "../constants";
import type { RunState } from "../state";
import { centeredRect, circle, sprite } from "./draw";
import { COLORS } from "./theme";

/** The stage position of a world point. */
export function toStage(
  run: RunState,
  wx: number,
  wy: number,
): [number, number] {
  return [wx - run.player.x + STAGE_CX, wy - run.player.y + STAGE_CY];
}

/** The ground: the produced tile repeated in world space, or a drawn one. */
export function drawGround(
  ctx: CanvasRenderingContext2D,
  run: RunState,
  assets: Assets,
): void {
  const tile = assets.image(ASSET_PATHS.ground);
  // The world x that lands on stage x 0, wrapped to one tile.
  const originX = run.player.x - STAGE_CX;
  const originY = run.player.y - STAGE_CY;
  const startX = -(((originX % GROUND_TILE) + GROUND_TILE) % GROUND_TILE);
  const startY = -(((originY % GROUND_TILE) + GROUND_TILE) % GROUND_TILE);
  for (let y = startY; y < STAGE_H; y += GROUND_TILE) {
    for (let x = startX; x < STAGE_W; x += GROUND_TILE) {
      if (tile) {
        ctx.drawImage(tile, x, y, GROUND_TILE, GROUND_TILE);
        continue;
      }
      // The stand-in tile: flagstones with a seam along the top and left.
      ctx.fillStyle = COLORS.groundA;
      ctx.fillRect(x, y, GROUND_TILE, GROUND_TILE);
      ctx.fillStyle = COLORS.groundB;
      ctx.fillRect(x + 8, y + 8, 16, 16);
      ctx.fillRect(x + 36, y + 36, 20, 12);
      ctx.fillStyle = COLORS.groundLine;
      ctx.fillRect(x, y, GROUND_TILE, 1);
      ctx.fillRect(x, y, 1, GROUND_TILE);
    }
  }
}

function drawGems(
  ctx: CanvasRenderingContext2D,
  run: RunState,
  assets: Assets,
): void {
  for (const gem of run.gems) {
    const [x, y] = toStage(run, gem.x, gem.y);
    const size = GEM_SIZES[gem.tier];
    const image = assets.image(ASSET_PATHS.gem(gem.tier));
    if (image) {
      sprite(ctx, image, x, y, size, size);
      continue;
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);
    centeredRect(ctx, 0, 0, size * 0.72, size * 0.72, COLORS.gem);
    ctx.restore();
  }
}

function drawPickups(
  ctx: CanvasRenderingContext2D,
  run: RunState,
  assets: Assets,
): void {
  for (const pickup of run.pickups) {
    const [x, y] = toStage(run, pickup.x, pickup.y);
    const image = assets.image(ASSET_PATHS.pickup(pickup.kind));
    if (image) {
      sprite(ctx, image, x, y, PICKUP_SIZE, PICKUP_SIZE);
      continue;
    }
    switch (pickup.kind) {
      case "chest":
        centeredRect(ctx, x, y, 22, 16, COLORS.chest, COLORS.lamplighterDark);
        break;
      case "bread":
        circle(ctx, x, y, 9, COLORS.bread, COLORS.lamplighterDark);
        break;
      case "draft":
        ctx.strokeStyle = COLORS.draft;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x - 10, y - 4);
        ctx.quadraticCurveTo(x, y - 12, x + 10, y - 4);
        ctx.moveTo(x - 10, y + 6);
        ctx.quadraticCurveTo(x, y - 2, x + 10, y + 6);
        ctx.stroke();
        break;
    }
  }
}

function drawZones(ctx: CanvasRenderingContext2D, run: RunState): void {
  for (const zone of run.zones) {
    const [x, y] = toStage(run, zone.x, zone.y);
    if (zone.kind === "slash") {
      centeredRect(
        ctx,
        x,
        y,
        zone.width ?? 0,
        zone.height ?? 0,
        COLORS.zone,
        COLORS.zoneEdge,
      );
      continue;
    }
    circle(ctx, x, y, zone.radius, COLORS.zone, COLORS.zoneEdge);
  }
}

function drawProjectiles(ctx: CanvasRenderingContext2D, run: RunState): void {
  for (const projectile of run.projectiles) {
    const [x, y] = toStage(run, projectile.x, projectile.y);
    circle(ctx, x, y, projectile.radius, COLORS.projectile);
  }
}

function drawEnemies(
  ctx: CanvasRenderingContext2D,
  run: RunState,
  assets: Assets,
): void {
  for (const enemy of run.enemies) {
    const [x, y] = toStage(run, enemy.x, enemy.y);
    const def = ENEMIES[enemy.type];
    const frame = Math.floor(enemy.age / WALK_FRAME_TIME) % ENEMY_WALK_FRAMES;
    const image = assets.image(ASSET_PATHS.enemy(enemy.type, frame));
    if (image) {
      sprite(
        ctx,
        image,
        x,
        y,
        def.radius * 2,
        def.radius * 2,
        enemy.heading.x < 0,
      );
      continue;
    }
    const fill =
      def.rank === "dark"
        ? COLORS.dark
        : def.rank === "elite"
          ? COLORS.elite
          : COLORS.enemy;
    const edge = def.rank === "dark" ? COLORS.darkEdge : COLORS.enemyEdge;
    circle(ctx, x, y, def.radius, fill, edge);
  }
}

function drawPuffs(
  ctx: CanvasRenderingContext2D,
  run: RunState,
  assets: Assets,
): void {
  for (const puff of run.puffs) {
    const t = (run.tick - puff.bornTick) * TICK_DT;
    const frame = Math.min(
      PUFF_FRAMES - 1,
      Math.floor(t / (PUFF_TIME / PUFF_FRAMES)),
    );
    const [x, y] = toStage(run, puff.x, puff.y);
    const image = assets.image(ASSET_PATHS.puff(frame));
    if (image) {
      sprite(ctx, image, x, y, 24, 24);
      continue;
    }
    circle(ctx, x, y, 4 + frame * 3, COLORS.puff);
  }
}

function drawLamplighter(
  ctx: CanvasRenderingContext2D,
  run: RunState,
  assets: Assets,
): void {
  const { width, height } = LAMPLIGHTER_SIZE;
  const mirror = run.player.facing === "left";
  const frame =
    Math.floor((run.movedTicks * TICK_DT) / WALK_FRAME_TIME) %
    LAMPLIGHTER_WALK_FRAMES;
  const image = run.moving
    ? assets.image(ASSET_PATHS.lamplighterWalk(frame))
    : assets.image(ASSET_PATHS.lamplighterIdle);
  circle(ctx, STAGE_CX, STAGE_CY, PLAYER_RADIUS * 5, COLORS.lamplight);
  if (image) {
    sprite(ctx, image, STAGE_CX, STAGE_CY, width, height, mirror);
    return;
  }
  ctx.save();
  ctx.translate(STAGE_CX, STAGE_CY);
  if (mirror) ctx.scale(-1, 1);
  const bob = run.moving ? (frame % 2) * 2 : 0;
  centeredRect(
    ctx,
    0,
    bob,
    width,
    height,
    COLORS.lamplighter,
    COLORS.lamplighterDark,
  );
  // The lamp, held out on the facing side.
  centeredRect(ctx, width / 2 + 4, -6 + bob, 8, 10, COLORS.highlight);
  ctx.restore();
}

/** Everything the view shows, in draw order. */
export function drawWorld(
  ctx: CanvasRenderingContext2D,
  run: RunState,
  assets: Assets,
): void {
  drawGround(ctx, run, assets);
  drawZones(ctx, run);
  drawGems(ctx, run, assets);
  drawPickups(ctx, run, assets);
  drawPuffs(ctx, run, assets);
  drawEnemies(ctx, run, assets);
  drawProjectiles(ctx, run);
  drawLamplighter(ctx, run, assets);
}
