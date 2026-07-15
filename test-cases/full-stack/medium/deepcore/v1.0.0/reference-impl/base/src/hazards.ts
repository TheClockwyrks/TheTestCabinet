// Deepcore — underground hazards (specs/hazards.md). There are NO enemies; the mine is
// the adversary. Gas pockets detonate when drilled (a hull hit + knockback + green
// blast), lava drains hull fast on contact (route around it), a hard landing deals impact
// damage scaled to the excess speed, and the extracted Core Sample runs a 90-second
// destabilization timer that, if it expires, detonates lethally.

import {
  GAS_BASE_DAMAGE,
  GAS_BASE_DEPTH_M,
  GAS_DAMAGE_PER_METER,
  LAVA_DAMAGE_RATE,
  METERS_PER_ROW,
  SAFE_FALL_SPEED,
  FALL_IMPACT_SCALE,
  TILE_SIZE,
} from "./constants";
import { MINER_H, MINER_W, minerCenterX, minerCenterY } from "./physics";
import { bandForRow, colAtX, rowAtY, tileLeft, tileTop } from "./world";
import type { Game } from "./game";

/**
 * Raw gas-explosion damage at a depth, before the radiator (specs/hazards.md): flat until
 * the depth where gas first appears, then rising with depth so the deep bands are lethal
 * without hull + radiator investment.
 */
export function gasDamageAt(depthMeters: number): number {
  return Math.max(
    GAS_BASE_DAMAGE,
    GAS_BASE_DAMAGE + GAS_DAMAGE_PER_METER * (depthMeters - GAS_BASE_DEPTH_M),
  );
}

/** A gas pocket detonates when drilled into (specs/hazards.md). */
export function detonateGas(game: Game, col: number, row: number): void {
  const band = bandForRow(row);
  game.grid[row]![col] = { kind: "tunnel", band };
  const tx = tileLeft(col) + TILE_SIZE / 2;
  const ty = tileTop(row) + TILE_SIZE / 2;
  game.fxQueue.push({ kind: "gas-explosion", x: tx, y: ty });
  game.sndQueue.push("gas-explosion");

  const m = game.miner;
  const dx = minerCenterX(m) - tx;
  const dy = minerCenterY(m) - ty;
  const dist = Math.hypot(dx, dy);
  // Adjacent miner takes the hit + a hard shove away from the blast. Damage scales with
  // depth and is cut by the radiator (specs/hazards.md, specs/upgrades.md).
  if (dist < TILE_SIZE * 1.7) {
    m.hull -= gasDamageAt(row * METERS_PER_ROW) * (1 - game.radiatorEff());
    game.hurtFlash = 0.35;
    const nx = dist > 0.01 ? dx / dist : 0;
    const ny = dist > 0.01 ? dy / dist : -1;
    // Knockback impulse (px/s) scaled with the 80px tile.
    m.vx += nx * 500;
    m.vy += ny * 433 - 200; // shove away, with a little lift
  }
}

/** Whether the miner's (slightly expanded) box touches any lava tile. */
function lavaContact(game: Game): { x: number; y: number } | null {
  const m = game.miner;
  const x = m.x - 5;
  const y = m.y - 5;
  const w = MINER_W + 10;
  const h = MINER_H + 10;
  const c0 = colAtX(x);
  const c1 = colAtX(x + w);
  const r0 = rowAtY(y);
  const r1 = rowAtY(y + h);
  for (let r = r0; r <= r1; r++) {
    if (r < 0 || r >= game.grid.length) continue;
    for (let c = c0; c <= c1; c++) {
      if (c < 0 || c >= game.grid[0]!.length) continue;
      if (game.grid[r]![c]!.kind === "lava") {
        return { x: tileLeft(c) + TILE_SIZE / 2, y: tileTop(r) + TILE_SIZE / 2 };
      }
    }
  }
  return null;
}

/** Drain hull while touching lava, with a sizzle/ember VFX + hurt (specs/hazards.md). */
export function updateLavaContact(game: Game, dt: number): void {
  const hit = lavaContact(game);
  if (!hit) return;
  game.miner.hull -= LAVA_DAMAGE_RATE * (1 - game.radiatorEff()) * dt;
  game.hurtFlash = Math.max(game.hurtFlash, 0.2);
  game.lavaFxCd -= dt;
  if (game.lavaFxCd <= 0) {
    game.lavaFxCd = 0.25;
    // Ember at the contact point, biased toward the miner.
    const ex = (hit.x + minerCenterX(game.miner)) / 2;
    const ey = (hit.y + minerCenterY(game.miner)) / 2;
    game.fxQueue.push({ kind: "lava-embers", x: ex, y: ey });
    game.sndQueue.push("lava-sizzle");
  }
}

/** A landing above the safe threshold deals impact hull damage (specs/hazards.md). */
export function landImpact(game: Game, speed: number): void {
  const excess = speed - SAFE_FALL_SPEED;
  if (excess <= 0) return;
  const dmg = excess * FALL_IMPACT_SCALE;
  game.miner.hull -= dmg;
  game.hurtFlash = Math.max(game.hurtFlash, 0.3);
  game.fxQueue.push({ kind: "impact-dust", x: minerCenterX(game.miner), y: game.miner.y + MINER_H });
  game.sndQueue.push("impact");
}
