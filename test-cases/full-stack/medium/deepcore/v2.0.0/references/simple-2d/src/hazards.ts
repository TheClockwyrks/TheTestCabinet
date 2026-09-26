// Deepcore — the dangers of the mine (specs/hazards.md).
//
// There are no enemies. A gas pocket detonates when it breaks, lava drains hull
// on contact and burns a lump when it is drilled through, a hard landing costs
// hull in proportion to the speed above the safe one, and an explosives blast
// clears a block and chains every gas pocket inside it.

import {
  CORE_BLAST_TILES,
  CUES,
  GAS_BLAST_TILES,
  GAS_KNOCKBACK,
  IMPACT_DAMAGE_RATE,
  IMPACT_SAFE_SPEED,
  LAVA_CONTACT_DPS,
  MINER_H,
  MINER_W,
  TILE,
} from "./constants";
import { cue } from "./audio";
import { addShake, fx, hurt, raiseNotice } from "./feedback";
import { radiatorEffect } from "./figures";
import { minerCenterX, minerCenterY } from "./physics";
import { setDraftTile, writeTiles } from "./state";
import type { Draft } from "./state";
import type { Tile } from "./game";
import {
  SHAKE_CORE_AMP,
  SHAKE_CORE_TIME,
  SHAKE_GAS_AMP,
  SHAKE_GAS_TIME,
  SHAKE_IMPACT_PER_SPEED,
  depthFraction,
  gasDamageAt,
} from "./tuning";
import { bandForRow, cellCenter, colAtX, makeTile, rowAtY } from "./world";

/** Seconds between the ember bursts a sustained lava contact throws off. */
const LAVA_FX_PERIOD = 0.25;

/**
 * A gas pocket detonates. The cell becomes an open tunnel either way; a miner
 * whose center is within `GAS_BLAST_TILES` takes the depth-scaled hull hit,
 * which nothing reduces, and is shoved directly away from the pocket at
 * `GAS_KNOCKBACK`.
 */
export function detonateGas(d: Draft, col: number, row: number): void {
  const band = bandForRow(row, d.coreRow);
  setDraftTile(d, col, row, makeTile("tunnel", band));
  const at = cellCenter(col, row);
  fx(d, "gas-explosion", at.x, at.y, 1.5);
  cue(d, CUES.gasExplosion);
  addShake(d, SHAKE_GAS_AMP, SHAKE_GAS_TIME);

  const m = d.miner;
  const dx = minerCenterX(m) - at.x;
  const dy = minerCenterY(m) - at.y;
  const dist = Math.hypot(dx, dy);
  if (dist > GAS_BLAST_TILES * TILE) return;

  m.hull -= gasDamageAt(depthFraction(row, d.coreRow));
  hurt(d);
  // The shove is travel: a miner whose travel faculty is held keeps the velocity
  // it was posed with, exactly as gravity and collision leave it alone.
  if (m.travel) {
    const nx = dist > 0.01 ? dx / dist : 0;
    const ny = dist > 0.01 ? dy / dist : -1;
    m.vx = nx * GAS_KNOCKBACK;
    m.vy = ny * GAS_KNOCKBACK;
  }
  raiseNotice(d, "gas");
}

/**
 * An explosives blast clears the square block of `radius` cells around the
 * miner's cell. Rock, ore, gemstone, lava, and unbreakable stone all clear to
 * tunnel and every ore in the block is destroyed rather than collected; a gas
 * pocket detonates exactly as a drilled one, and detonations chain within the
 * block. Bedrock, material nodes, and the Core are immune, so a blast can never
 * destroy a component's source.
 */
export function detonateBlast(
  d: Draft,
  centerCol: number,
  centerRow: number,
  radius: number,
): void {
  const edits: { col: number; row: number; tile: Tile }[] = [];
  for (let r = centerRow - radius; r <= centerRow + radius; r += 1) {
    const line = d.grid[r];
    if (!line) continue;
    for (let c = centerCol - radius; c <= centerCol + radius; c += 1) {
      const tile = line[c];
      if (!tile) continue;
      const kind = tile.kind;
      if (kind === "bedrock" || kind === "core" || kind === "material")
        continue;
      if (kind === "gas") detonateGas(d, c, r);
      else if (kind !== "tunnel") {
        edits.push({
          col: c,
          row: r,
          tile: makeTile("tunnel", bandForRow(r, d.coreRow)),
        });
      }
    }
  }
  d.grid = writeTiles(d.grid, edits);
  const at = cellCenter(centerCol, centerRow);
  fx(d, "gas-explosion", at.x, at.y, 1 + radius);
  cue(d, CUES.gasExplosion);
  addShake(d, SHAKE_GAS_AMP * (0.7 + 0.3 * radius), SHAKE_GAS_TIME);
}

/**
 * The lava cell the miner's box touches, or `null`. The cell being drilled is
 * skipped: its heat is billed as the drill's lump when it breaks, so charging
 * the contact drain on it too would bill the same cell twice.
 */
function lavaContact(d: Draft): { x: number; y: number } | null {
  const m = d.miner;
  const drilling = m.drilling;
  const c0 = colAtX(m.x);
  const c1 = colAtX(m.x + MINER_W - 0.001);
  const r0 = rowAtY(m.y);
  const r1 = rowAtY(m.y + MINER_H - 0.001);
  const cols = d.grid[0]?.length ?? 0;
  for (let r = r0; r <= r1; r += 1) {
    if (r < 0 || r >= d.grid.length) continue;
    for (let c = c0; c <= c1; c += 1) {
      if (c < 0 || c >= cols) continue;
      if (drilling && drilling.col === c && drilling.row === r) continue;
      if (d.grid[r][c].kind === "lava") return cellCenter(c, r);
    }
  }
  return null;
}

/** Drain hull for as long as the miner's box overlaps a lava cell. */
export function updateLavaContact(d: Draft, dt: number): void {
  const hit = lavaContact(d);
  if (!hit) return;
  d.miner.hull -= LAVA_CONTACT_DPS * (1 - radiatorEffect(d.tiers)) * dt;
  hurt(d);
  raiseNotice(d, "lava");
  d.lavaFxCd -= dt;
  if (d.lavaFxCd <= 0) {
    d.lavaFxCd = LAVA_FX_PERIOD;
    fx(
      d,
      "lava-embers",
      (hit.x + minerCenterX(d.miner)) / 2,
      (hit.y + minerCenterY(d.miner)) / 2,
    );
    cue(d, CUES.lavaSizzle);
  }
}

/** A landing above the safe speed costs hull in proportion to the excess. */
export function landImpact(d: Draft, speed: number): void {
  const excess = speed - IMPACT_SAFE_SPEED;
  if (excess <= 0) return;
  d.miner.hull -= excess * IMPACT_DAMAGE_RATE;
  hurt(d);
  fx(d, "impact-dust", minerCenterX(d.miner), d.miner.y + MINER_H);
  cue(d, CUES.impact);
  addShake(d, Math.min(9, excess * SHAKE_IMPACT_PER_SPEED), 0.26);
}

/**
 * The blast a jettisoned Core Sample makes where it lies. True when the miner is
 * inside it.
 */
export function detonateGroundCore(
  d: Draft,
  col: number,
  row: number,
): boolean {
  const at = cellCenter(col, row);
  fx(d, "core-detonation", at.x, at.y);
  cue(d, CUES.gasExplosion);
  addShake(d, SHAKE_CORE_AMP, SHAKE_CORE_TIME);
  const dist = Math.hypot(
    minerCenterX(d.miner) - at.x,
    minerCenterY(d.miner) - at.y,
  );
  return dist <= CORE_BLAST_TILES * TILE;
}
