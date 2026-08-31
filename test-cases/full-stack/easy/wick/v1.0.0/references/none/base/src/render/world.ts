// Wick — the world under the camera (specs/world.md "The camera and the
// view", specs/assets.md "The sprites", "Animation").
//
// Every world point is drawn at `(wx − player.x + STAGE_CX, wy − player.y +
// STAGE_CY)`, so the lamplighter sits at the stage center and the ground
// pattern, fixed in world space, slides beneath it. A produced sprite is
// drawn at one unit per pixel where it decoded; where it did not, a
// code-drawn stand-in of the same size takes its place. Every animation is
// counted in ticks, so it holds still on every screen but `playing`.

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
  PUFF_SIZE,
  STAGE_CX,
  STAGE_CY,
  STAGE_H,
  STAGE_W,
  TICK_DT,
} from "../constants";
import type { RunState } from "../state";
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

/** The zones on the ground: puddles and the aura under everything else. */
function drawGroundZones(
  ctx: CanvasRenderingContext2D,
  run: RunState,
  assets: Assets,
): void {
  for (const zone of run.zones) {
    if (zone.kind !== "puddle" && zone.kind !== "aura") continue;
    const [x, y] = toStage(run, zone.x, zone.y);
    drawZone(ctx, run, assets, zone, x, y);
  }
}

/** The zones in the air: slashes, lanterns, strikes, and bursts. */
function drawAirZones(
  ctx: CanvasRenderingContext2D,
  run: RunState,
  assets: Assets,
): void {
  for (const zone of run.zones) {
    if (zone.kind === "puddle" || zone.kind === "aura") continue;
    const [x, y] = toStage(run, zone.x, zone.y);
    drawZone(ctx, run, assets, zone, x, y);
  }
}

function drawProjectiles(
  ctx: CanvasRenderingContext2D,
  run: RunState,
  assets: Assets,
): void {
  for (const projectile of run.projectiles) {
    const [x, y] = toStage(run, projectile.x, projectile.y);
    drawProjectile(ctx, run, assets, projectile, x, y);
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
    const frame = walkFrame(enemy.age, ENEMY_WALK_FRAMES);
    const image = assets.image(ASSET_PATHS.enemy(enemy.type, frame));
    if (image) {
      sprite(ctx, image, x, y, def.radius * 2, def.radius * 2, {
        mirror: enemy.heading.x < 0,
      });
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
    const frame = puffFrame(ageOf(run, puff.bornTick));
    const [x, y] = toStage(run, puff.x, puff.y);
    const image = assets.image(ASSET_PATHS.puff(frame));
    if (image) {
      sprite(ctx, image, x, y, PUFF_SIZE, PUFF_SIZE);
      continue;
    }
    circle(ctx, x, y, 4 + frame * 3, COLORS.puff);
  }
}

/** Draw the lamplighter centered at `(x, y)`, `scale` units per pixel. */
export function drawLamplighterAt(
  ctx: CanvasRenderingContext2D,
  run: RunState,
  assets: Assets,
  x: number,
  y: number,
  scale = 1,
): void {
  const width = LAMPLIGHTER_SIZE.width * scale;
  const height = LAMPLIGHTER_SIZE.height * scale;
  const mirror = run.player.facing === "left";
  const frame = walkFrame(run.movedTicks * TICK_DT, LAMPLIGHTER_WALK_FRAMES);
  const image = run.moving
    ? assets.image(ASSET_PATHS.lamplighterWalk(frame))
    : assets.image(ASSET_PATHS.lamplighterIdle);
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

/** Everything the view shows, in draw order. */
export function drawWorld(
  ctx: CanvasRenderingContext2D,
  run: RunState,
  assets: Assets,
): void {
  drawGround(ctx, run, assets);
  drawLamplight(ctx);
  drawGroundZones(ctx, run, assets);
  drawGems(ctx, run, assets);
  drawPickups(ctx, run, assets);
  drawPuffs(ctx, run, assets);
  drawEnemies(ctx, run, assets);
  drawAirZones(ctx, run, assets);
  drawProjectiles(ctx, run, assets);
  drawLamplighterAt(ctx, run, assets, STAGE_CX, STAGE_CY);
}
