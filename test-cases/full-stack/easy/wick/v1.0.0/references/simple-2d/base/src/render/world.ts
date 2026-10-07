// Wick — the world under the camera (specs/world.md "The camera and the
// view", specs/ui.md "`playing`", specs/assets.md "The sprites",
// "Animation").
//
// Every world point is drawn at `(wx − player.x + STAGE_CX, wy − player.y +
// STAGE_CY)`, so the lamplighter sits at the stage center and the ground
// pattern, fixed in world space, slides beneath it. A produced sprite is
// drawn at one unit per pixel where it decoded; where it did not, a
// code-drawn stand-in of the same size takes its place. Every animation is
// counted in ticks, so it holds still on every screen but `playing`. Each
// enemy, gem, and pickup is drawn by a function of its own, which the almanac
// draws its pictures with as well, so one thing looks the same wherever it is
// shown.

import {
  ENEMIES,
  ENEMY_FRAMES,
  GEM_PATHS,
  GEM_SPRITE_SIZES,
  GROUND_TILE_PATH,
  GROUND_TILE_SIZE,
  HURT_FLASH,
  LAMPLIGHTER_IDLE_PATH,
  LAMPLIGHTER_SPRITE_HEIGHT,
  LAMPLIGHTER_SPRITE_WIDTH,
  LAMPLIGHTER_WALK_SHEET,
  PICKUP_PATHS,
  PICKUP_SPRITE_SIZE,
  PLAYER_RADIUS,
  PUFF_SHEET,
  PUFF_SPRITE_SIZE,
  STAGE_CX,
  STAGE_CY,
  STAGE_H,
  STAGE_W,
  TICK_DT,
  type EnemyId,
  type EnemyRank,
  type GemTier,
  type PickupKind,
} from "../constants";
import { enemyFrame, sheetFrame, spriteImage } from "../assets";
import type { RunState } from "../game";
import { centeredRect, circle, sprite } from "./draw";
import {
  ageOf,
  drawProjectile,
  drawZone,
  puffFrame,
  walkFrame,
} from "./effects";
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
export function drawGround(ctx: CanvasRenderingContext2D, run: RunState): void {
  const tile = spriteImage(GROUND_TILE_PATH);
  const size = GROUND_TILE_SIZE;
  // The world x that lands on stage x 0, wrapped to one tile.
  const originX = run.player.x - STAGE_CX;
  const originY = run.player.y - STAGE_CY;
  const startX = -(((originX % size) + size) % size);
  const startY = -(((originY % size) + size) % size);
  for (let y = startY; y < STAGE_H; y += size) {
    for (let x = startX; x < STAGE_W; x += size) {
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

/** The lamp's light on the ground about the lamplighter. */
function drawLamplight(ctx: CanvasRenderingContext2D): void {
  const reach = PLAYER_RADIUS * 9;
  const light = ctx.createRadialGradient(
    STAGE_CX,
    STAGE_CY,
    PLAYER_RADIUS,
    STAGE_CX,
    STAGE_CY,
    reach,
  );
  light.addColorStop(0, COLORS.lamplight);
  light.addColorStop(1, "rgba(255, 196, 96, 0)");
  ctx.fillStyle = light;
  ctx.fillRect(STAGE_CX - reach, STAGE_CY - reach, reach * 2, reach * 2);
}

/** One gem of `tier`, centered at `(x, y)` and `size` units across. */
export function drawGem(
  ctx: CanvasRenderingContext2D,
  tier: GemTier,
  x: number,
  y: number,
  size: number = GEM_SPRITE_SIZES[tier],
): void {
  const image = spriteImage(GEM_PATHS[tier]);
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

/** One pickup of `kind`, centered at `(x, y)` and `size` units across. */
export function drawPickup(
  ctx: CanvasRenderingContext2D,
  kind: PickupKind,
  x: number,
  y: number,
  size: number = PICKUP_SPRITE_SIZE,
): void {
  const image = spriteImage(PICKUP_PATHS[kind]);
  if (image) {
    sprite(ctx, image, x, y, size, size);
    return;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / PICKUP_SPRITE_SIZE, size / PICKUP_SPRITE_SIZE);
  switch (kind) {
    case "chest":
      centeredRect(ctx, 0, 0, 22, 16, COLORS.chest, COLORS.lamplighterDark);
      break;
    case "bread":
      circle(ctx, 0, 0, 9, COLORS.bread, COLORS.lamplighterDark);
      break;
    case "draft":
      ctx.strokeStyle = COLORS.draft;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-10, -4);
      ctx.quadraticCurveTo(0, -12, 10, -4);
      ctx.moveTo(-10, 6);
      ctx.quadraticCurveTo(0, -2, 10, 6);
      ctx.stroke();
      break;
  }
  ctx.restore();
}

/** The colors a stand-in enemy of each rank is drawn in. */
const ENEMY_COLORS: Readonly<
  Record<EnemyRank, { readonly fill: string; readonly edge: string }>
> = {
  common: { fill: COLORS.enemy, edge: COLORS.enemyEdge },
  elite: { fill: COLORS.elite, edge: COLORS.enemyEdge },
  dark: { fill: COLORS.dark, edge: COLORS.darkEdge },
};

/** One enemy of `type` at `frame` of its walk, centered at `(x, y)`. */
export function drawEnemy(
  ctx: CanvasRenderingContext2D,
  type: EnemyId,
  x: number,
  y: number,
  frame: number,
  size: number = ENEMIES[type].radius * 2,
  mirror = false,
): void {
  const image = spriteImage(enemyFrame(type, frame));
  if (image) {
    sprite(ctx, image, x, y, size, size, { mirror });
    return;
  }
  const { fill, edge } = ENEMY_COLORS[ENEMIES[type].rank];
  circle(ctx, x, y, size / 2, fill, edge);
}

function drawGems(ctx: CanvasRenderingContext2D, run: RunState): void {
  for (const gem of run.gems) {
    const [x, y] = toStage(run, gem.x, gem.y);
    drawGem(ctx, gem.tier, x, y);
  }
}

function drawPickups(ctx: CanvasRenderingContext2D, run: RunState): void {
  for (const pickup of run.pickups) {
    const [x, y] = toStage(run, pickup.x, pickup.y);
    drawPickup(ctx, pickup.kind, x, y);
  }
}

/** The zones on the ground: puddles and the aura under everything else. */
function drawGroundZones(ctx: CanvasRenderingContext2D, run: RunState): void {
  for (const zone of run.zones) {
    if (zone.kind !== "puddle" && zone.kind !== "aura") continue;
    const [x, y] = toStage(run, zone.x, zone.y);
    drawZone(ctx, run, zone, x, y);
  }
}

/** The zones in the air: slashes, lanterns, strikes, and bursts. */
function drawAirZones(ctx: CanvasRenderingContext2D, run: RunState): void {
  for (const zone of run.zones) {
    if (zone.kind === "puddle" || zone.kind === "aura") continue;
    const [x, y] = toStage(run, zone.x, zone.y);
    drawZone(ctx, run, zone, x, y);
  }
}

function drawProjectiles(ctx: CanvasRenderingContext2D, run: RunState): void {
  for (const projectile of run.projectiles) {
    const [x, y] = toStage(run, projectile.x, projectile.y);
    drawProjectile(ctx, run, projectile, x, y);
  }
}

function drawEnemies(ctx: CanvasRenderingContext2D, run: RunState): void {
  for (const enemy of run.enemies) {
    const [x, y] = toStage(run, enemy.x, enemy.y);
    const def = ENEMIES[enemy.type];
    drawEnemy(
      ctx,
      enemy.type,
      x,
      y,
      walkFrame(enemy.age, ENEMY_FRAMES),
      def.radius * 2,
      enemy.heading.x < 0,
    );
  }
}

function drawPuffs(ctx: CanvasRenderingContext2D, run: RunState): void {
  for (const puff of run.puffs) {
    const frame = puffFrame(ageOf(run, puff.bornTick));
    const [x, y] = toStage(run, puff.x, puff.y);
    const image = spriteImage(sheetFrame(PUFF_SHEET, frame));
    if (image) {
      sprite(ctx, image, x, y, PUFF_SPRITE_SIZE, PUFF_SPRITE_SIZE);
      continue;
    }
    circle(ctx, x, y, 4 + frame * 3, COLORS.puff);
  }
}

/** Draw the lamplighter centered at `(x, y)`, `scale` units per pixel. */
export function drawLamplighterAt(
  ctx: CanvasRenderingContext2D,
  run: RunState,
  x: number,
  y: number,
  scale = 1,
): void {
  const width = LAMPLIGHTER_SPRITE_WIDTH * scale;
  const height = LAMPLIGHTER_SPRITE_HEIGHT * scale;
  const mirror = run.player.facing === "left";
  const frame = walkFrame(
    run.movedTicks * TICK_DT,
    LAMPLIGHTER_WALK_SHEET.frames,
  );
  const image = run.moving
    ? spriteImage(sheetFrame(LAMPLIGHTER_WALK_SHEET, frame))
    : spriteImage(LAMPLIGHTER_IDLE_PATH);
  if (image) {
    sprite(ctx, image, x, y, width, height, { mirror });
    return;
  }
  ctx.save();
  ctx.translate(x, y);
  if (mirror) ctx.scale(-1, 1);
  const bob = run.moving ? (frame % 2) * 2 * scale : 0;
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
  centeredRect(
    ctx,
    width / 2 + 4 * scale,
    -6 * scale + bob,
    8 * scale,
    10 * scale,
    COLORS.highlight,
  );
  ctx.restore();
}

/**
 * The hurt cast over the view while the flash runs: a red vignette that
 * closes in from the edges and fades as the flash counts down, so a tick
 * that took a hit never draws the stage a quiet one draws.
 */
function drawHurt(ctx: CanvasRenderingContext2D, run: RunState): void {
  if (run.hurtFlash <= 0) return;
  const strength = Math.min(1, run.hurtFlash / HURT_FLASH);
  const cast = ctx.createRadialGradient(
    STAGE_CX,
    STAGE_CY,
    STAGE_H / 4,
    STAGE_CX,
    STAGE_CY,
    STAGE_W,
  );
  cast.addColorStop(0, "rgba(226, 86, 79, 0)");
  cast.addColorStop(1, `rgba(226, 86, 79, ${0.75 * strength})`);
  ctx.fillStyle = cast;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
}

/** Everything the view shows, in draw order. */
export function drawWorld(ctx: CanvasRenderingContext2D, run: RunState): void {
  drawGround(ctx, run);
  drawLamplight(ctx);
  drawGroundZones(ctx, run);
  drawGems(ctx, run);
  drawPickups(ctx, run);
  drawPuffs(ctx, run);
  drawEnemies(ctx, run);
  drawAirZones(ctx, run);
  drawProjectiles(ctx, run);
  drawLamplighterAt(ctx, run, STAGE_CX, STAGE_CY);
  drawHurt(ctx, run);
}
