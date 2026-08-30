// Deepcore — the dangers of the mine (specs/hazards.md).
//
// There are no enemies. A gas pocket detonates when it breaks, lava drains hull on
// contact and burns a lump when it is drilled through, a hard landing costs hull in
// proportion to the speed above the safe one, and an explosives blast clears a block
// and chains every gas pocket inside it.

import {
  CORE_BLAST_TILES,
  GAS_BLAST_TILES,
  GAS_KNOCKBACK,
  IMPACT_DAMAGE_RATE,
  IMPACT_SAFE_SPEED,
  LAVA_CONTACT_DPS,
  MINER_H,
  MINER_W,
  SHAKE_CORE_AMP,
  SHAKE_CORE_TIME,
  SHAKE_GAS_AMP,
  SHAKE_GAS_TIME,
  SHAKE_IMPACT_PER_SPEED,
  TILE,
  depthFraction,
  gasDamageAt,
} from "./constants";
import { minerCenterX, minerCenterY } from "./physics";
import { bandForRow, colAtX, rowAtY, tileLeft, tileTop } from "./world";
import type { Game } from "./game";

/** The world center of a cell. */
export function cellCenter(col: number, row: number): { x: number; y: number } {
  return { x: tileLeft(col) + TILE / 2, y: tileTop(row) + TILE / 2 };
}

/**
 * A gas pocket detonates. The cell becomes an open tunnel either way; a miner whose
 * center is within GAS_BLAST_TILES takes the depth-scaled hull hit, which nothing
 * reduces, and is shoved directly away from the pocket at GAS_KNOCKBACK.
 */
export function detonateGas(game: Game, col: number, row: number): void {
  const band = bandForRow(row, game.coreRow);
  game.grid[row]![col] = { kind: "tunnel", band };
  const at = cellCenter(col, row);
  game.fxQueue.push({ kind: "gas-explosion", x: at.x, y: at.y, scale: 1.5 });
  game.sndQueue.push("gas-explosion");
  game.addShake(SHAKE_GAS_AMP, SHAKE_GAS_TIME);

  const m = game.miner;
  const dx = minerCenterX(m) - at.x;
  const dy = minerCenterY(m) - at.y;
  const dist = Math.hypot(dx, dy);
  if (dist > GAS_BLAST_TILES * TILE) return;

  m.hull -= gasDamageAt(depthFraction(row, game.coreRow));
  game.hurt();
  // The shove is travel: a miner whose travel faculty is held keeps the velocity
  // it was posed with, exactly as gravity and collision leave it alone.
  if (m.travel) {
    const nx = dist > 0.01 ? dx / dist : 0;
    const ny = dist > 0.01 ? dy / dist : -1;
    m.vx = nx * GAS_KNOCKBACK;
    m.vy = ny * GAS_KNOCKBACK;
  }
  game.raiseNotice("gas");
}

/**
 * An explosives blast clears the square block of `radius` cells around the miner's
 * cell. Rock, ore, gemstone, lava, and unbreakable stone all clear to tunnel and
 * every ore in the block is destroyed rather than collected; a gas pocket detonates
 * exactly as a drilled one, and detonations chain within the block. Bedrock, material
 * nodes, and the Core are immune, so a blast can never destroy a component's source.
 */
export function detonateBlast(
  game: Game,
  centerCol: number,
  centerRow: number,
  radius: number,
): void {
  for (let r = centerRow - radius; r <= centerRow + radius; r++) {
    const line = game.grid[r];
    if (!line) continue;
    for (let c = centerCol - radius; c <= centerCol + radius; c++) {
      const tile = line[c];
      if (!tile) continue;
      const kind = tile.kind;
      if (kind === "bedrock" || kind === "core" || kind === "material")
        continue;
      if (kind === "gas") detonateGas(game, c, r);
      else if (kind !== "tunnel")
        line[c] = { kind: "tunnel", band: bandForRow(r, game.coreRow) };
    }
  }
  const at = cellCenter(centerCol, centerRow);
  game.fxQueue.push({
    kind: "gas-explosion",
    x: at.x,
    y: at.y,
    scale: 1 + radius,
  });
  game.sndQueue.push("gas-explosion");
  game.addShake(SHAKE_GAS_AMP * (0.7 + 0.3 * radius), SHAKE_GAS_TIME);
}

/**
 * The lava cell the miner's box touches, or null. The cell currently being drilled is
 * skipped: its heat is billed as the drill's lump when it breaks, so charging the
 * contact drain on it too would bill the same cell twice.
 */
function lavaContact(game: Game): { x: number; y: number } | null {
  const m = game.miner;
  const drilling = m.drilling;
  const c0 = colAtX(m.x);
  const c1 = colAtX(m.x + MINER_W - 0.001);
  const r0 = rowAtY(m.y);
  const r1 = rowAtY(m.y + MINER_H - 0.001);
  const cols = game.grid[0]?.length ?? 0;
  for (let r = r0; r <= r1; r++) {
    if (r < 0 || r >= game.grid.length) continue;
    for (let c = c0; c <= c1; c++) {
      if (c < 0 || c >= cols) continue;
      if (drilling && drilling.col === c && drilling.row === r) continue;
      if (game.grid[r]![c]!.kind === "lava") return cellCenter(c, r);
    }
  }
  return null;
}

/** Drain hull for as long as the miner's box overlaps a lava cell. */
export function updateLavaContact(game: Game, dt: number): void {
  const hit = lavaContact(game);
  if (!hit) return;
  game.miner.hull -= LAVA_CONTACT_DPS * (1 - game.radiatorEffect()) * dt;
  game.hurt();
  game.raiseNotice("lava");
  game.lavaFxCd -= dt;
  if (game.lavaFxCd <= 0) {
    game.lavaFxCd = 0.25;
    game.fxQueue.push({
      kind: "lava-embers",
      x: (hit.x + minerCenterX(game.miner)) / 2,
      y: (hit.y + minerCenterY(game.miner)) / 2,
    });
    game.sndQueue.push("lava-sizzle");
  }
}

/** A landing above the safe speed costs hull in proportion to the excess. */
export function landImpact(game: Game, speed: number): void {
  const excess = speed - IMPACT_SAFE_SPEED;
  if (excess <= 0) return;
  game.miner.hull -= excess * IMPACT_DAMAGE_RATE;
  game.hurt();
  game.fxQueue.push({
    kind: "impact-dust",
    x: minerCenterX(game.miner),
    y: game.miner.y + MINER_H,
  });
  game.sndQueue.push("impact");
  game.addShake(Math.min(9, excess * SHAKE_IMPACT_PER_SPEED), 0.26);
}

/** The blast a jettisoned Core Sample makes where it lies. */
export function detonateGroundCore(
  game: Game,
  col: number,
  row: number,
): boolean {
  const at = cellCenter(col, row);
  game.fxQueue.push({ kind: "core-detonation", x: at.x, y: at.y });
  game.sndQueue.push("gas-explosion");
  game.addShake(SHAKE_CORE_AMP, SHAKE_CORE_TIME);
  const dist = Math.hypot(
    minerCenterX(game.miner) - at.x,
    minerCenterY(game.miner) - at.y,
  );
  return dist <= CORE_BLAST_TILES * TILE;
}
