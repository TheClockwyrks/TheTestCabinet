// Wick — the world's pictures (specs/world.md "The camera and the view",
// specs/assets.md "The sprites", "Animation").
//
// Every actor in the night draws through one of these, in world units at the
// world position its record holds: the camera follows the lamplighter at zoom
// `1`, so a world point lands exactly where the camera formula of
// `specs/world.md` puts it. A produced sprite is drawn at one unit per pixel
// where it decoded; where it did not, a code-drawn stand-in of the same size
// takes its place. Every animation is counted in ticks, so it holds still on
// every screen but `playing`.

import { enemyFrame, sheetFrame, type WickAssets } from "../assets";
import {
  ENEMIES,
  ENEMY_FRAMES,
  GEM_PATHS,
  GEM_SPRITE_SIZES,
  GROUND_TILE_PATH,
  GROUND_TILE_SIZE,
  LAMPLIGHTER_IDLE_PATH,
  LAMPLIGHTER_SPRITE_HEIGHT,
  LAMPLIGHTER_SPRITE_WIDTH,
  LAMPLIGHTER_WALK_SHEET,
  PICKUP_PATHS,
  PICKUP_SPRITE_SIZE,
  PLAYER_RADIUS,
  PUFF_SPRITE_SIZE,
  STAGE_CX,
  STAGE_CY,
  STAGE_H,
  STAGE_W,
  TICK_DT,
} from "../constants";
import type {
  EnemyId,
  EnemyState,
  GemState,
  GemTier,
  PickupKind,
  PickupState,
  Puff,
  RunState,
} from "../state";
import { centeredRect, circle, sprite } from "./draw";
import { ageOf, puffFrame, puffImage, walkFrame } from "./effects";
import { COLORS } from "./theme";

/**
 * The ground: the produced tile repeated in world space across the view
 * centered on `(cx, cy)`, or a drawn stand-in tile.
 */
export function drawGround(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  assets: WickAssets,
): void {
  const tile = assets.image(GROUND_TILE_PATH);
  const size = GROUND_TILE_SIZE;
  const left = cx - STAGE_CX;
  const top = cy - STAGE_CY;
  const startX = Math.floor(left / size) * size;
  const startY = Math.floor(top / size) * size;
  for (let y = startY; y < top + STAGE_H; y += size) {
    for (let x = startX; x < left + STAGE_W; x += size) {
      if (tile) {
        ctx.drawImage(tile, x, y, size, size);
        continue;
      }
      // The stand-in tile: flagstones with a seam along the top and left.
      ctx.fillStyle = COLORS.groundA;
      ctx.fillRect(x, y, size, size);
      ctx.fillStyle = COLORS.groundB;
      ctx.fillRect(x + 8, y + 8, 16, 16);
      ctx.fillRect(x + 36, y + 36, 20, 12);
      ctx.fillStyle = COLORS.groundLine;
      ctx.fillRect(x, y, size, 1);
      ctx.fillRect(x, y, 1, size);
    }
  }
}

/** The lamp's light on the ground about the lamplighter at `(x, y)`. */
export function drawLamplight(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
): void {
  const reach = PLAYER_RADIUS * 9;
  const light = ctx.createRadialGradient(x, y, PLAYER_RADIUS, x, y, reach);
  light.addColorStop(0, COLORS.lamplight);
  light.addColorStop(1, "rgba(255, 196, 96, 0)");
  ctx.fillStyle = light;
  ctx.fillRect(x - reach, y - reach, reach * 2, reach * 2);
}

/**
 * One gem's picture, centered at `(x, y)` and `scale` times its sprite's own
 * size. The almanac draws the same picture larger than the field does.
 */
export function drawGemPicture(
  ctx: CanvasRenderingContext2D,
  assets: WickAssets,
  tier: GemTier,
  x: number,
  y: number,
  scale = 1,
): void {
  const size = GEM_SPRITE_SIZES[tier] * scale;
  const image = assets.image(GEM_PATHS[tier]);
  if (image) {
    sprite(ctx, image, x, y, size, size);
    return;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 4);
  centeredRect(ctx, 0, 0, size * 0.72, size * 0.72, COLORS.gem);
  ctx.restore();
}

export function drawGem(
  ctx: CanvasRenderingContext2D,
  assets: WickAssets,
  gem: GemState,
): void {
  drawGemPicture(ctx, assets, gem.tier, gem.x, gem.y, 1);
}

/** One pickup's picture, centered at `(x, y)` at `scale` times its size. */
export function drawPickupPicture(
  ctx: CanvasRenderingContext2D,
  assets: WickAssets,
  kind: PickupKind,
  x: number,
  y: number,
  scale = 1,
): void {
  const size = PICKUP_SPRITE_SIZE * scale;
  const image = assets.image(PICKUP_PATHS[kind]);
  if (image) {
    sprite(ctx, image, x, y, size, size);
    return;
  }
  switch (kind) {
    case "chest":
      centeredRect(
        ctx,
        x,
        y,
        22 * scale,
        16 * scale,
        COLORS.chest,
        COLORS.lamplighterDark,
      );
      break;
    case "bread":
      circle(ctx, x, y, 9 * scale, COLORS.bread, COLORS.lamplighterDark);
      break;
    case "draft":
      ctx.strokeStyle = COLORS.draft;
      ctx.lineWidth = 3 * scale;
      ctx.beginPath();
      ctx.moveTo(x - 10 * scale, y - 4 * scale);
      ctx.quadraticCurveTo(x, y - 12 * scale, x + 10 * scale, y - 4 * scale);
      ctx.moveTo(x - 10 * scale, y + 6 * scale);
      ctx.quadraticCurveTo(x, y - 2 * scale, x + 10 * scale, y + 6 * scale);
      ctx.stroke();
      break;
  }
}

export function drawPickup(
  ctx: CanvasRenderingContext2D,
  assets: WickAssets,
  pickup: PickupState,
): void {
  drawPickupPicture(ctx, assets, pickup.kind, pickup.x, pickup.y, 1);
}

/**
 * One enemy's picture, centered at `(x, y)` and `size` units across, on walk
 * frame `frame`. The field draws it at twice the enemy's radius; the almanac
 * draws the same sheet larger.
 */
export function drawEnemyPicture(
  ctx: CanvasRenderingContext2D,
  assets: WickAssets,
  type: EnemyId,
  x: number,
  y: number,
  size: number,
  frame: number,
  mirror = false,
): void {
  const def = ENEMIES[type];
  const image = assets.image(enemyFrame(type, frame));
  if (image) {
    sprite(ctx, image, x, y, size, size, { mirror });
    return;
  }
  const fill =
    def.rank === "dark"
      ? COLORS.dark
      : def.rank === "elite"
        ? COLORS.elite
        : COLORS.enemy;
  const edge = def.rank === "dark" ? COLORS.darkEdge : COLORS.enemyEdge;
  circle(ctx, x, y, size / 2, fill, edge);
}

export function drawEnemy(
  ctx: CanvasRenderingContext2D,
  assets: WickAssets,
  enemy: EnemyState,
): void {
  const def = ENEMIES[enemy.type];
  drawEnemyPicture(
    ctx,
    assets,
    enemy.type,
    enemy.x,
    enemy.y,
    def.radius * 2,
    walkFrame(enemy.age, ENEMY_FRAMES),
    enemy.heading.x < 0,
  );
}

export function drawPuff(
  ctx: CanvasRenderingContext2D,
  run: RunState,
  assets: WickAssets,
  puff: Puff,
): void {
  const t = ageOf(run, puff.bornTick);
  const image = puffImage(assets, t);
  if (image) {
    sprite(ctx, image, puff.x, puff.y, PUFF_SPRITE_SIZE, PUFF_SPRITE_SIZE);
    return;
  }
  circle(ctx, puff.x, puff.y, 4 + puffFrame(t) * 3, COLORS.puff);
}

/**
 * Draw the lamplighter centered at `(x, y)` in whatever space the context
 * carries, `scale` units per pixel. The facing mirror is the caller's, since
 * it lives on the sprite component's own transform.
 */
export function drawLamplighterAt(
  ctx: CanvasRenderingContext2D,
  run: RunState,
  assets: WickAssets,
  x: number,
  y: number,
  scale = 1,
): void {
  const width = LAMPLIGHTER_SPRITE_WIDTH * scale;
  const height = LAMPLIGHTER_SPRITE_HEIGHT * scale;
  const frame = walkFrame(
    run.movedTicks * TICK_DT,
    LAMPLIGHTER_WALK_SHEET.frames,
  );
  const image = run.moving
    ? assets.image(sheetFrame(LAMPLIGHTER_WALK_SHEET, frame))
    : assets.image(LAMPLIGHTER_IDLE_PATH);
  if (image) {
    sprite(ctx, image, x, y, width, height);
    return;
  }
  const bob = run.moving ? (frame % 2) * 2 * scale : 0;
  centeredRect(
    ctx,
    x,
    y + bob,
    width,
    height,
    COLORS.lamplighter,
    COLORS.lamplighterDark,
  );
  // The lamp, held out on the facing side.
  centeredRect(
    ctx,
    x + width / 2 + 4 * scale,
    y - 6 * scale + bob,
    8 * scale,
    10 * scale,
    COLORS.highlight,
  );
}
