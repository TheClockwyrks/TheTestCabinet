// Deepcore — the scanner (specs/mining.md).
//
// Always-on, it points toward the NEAREST uncollected material the miner still needs — a
// Resonite while lacking Resonite, a Cryenite while lacking Cryenite — within its tier
// range. It NEVER points at the Core Sample (the Core is not hidden, only deep). Returns
// the direction (an angle) and a distance read the HUD draws in code; the drawn indicator
// tightens as the miner closes in.

import { SCANNER_RANGE, TILE_SIZE } from "./constants";
import { minerCenterX, minerCenterY } from "./physics";
import { tileLeft, tileTop } from "./world";
import type { Game } from "./game";

export interface ScanResult {
  /** True when a needed material exists at all (something to find). */
  needed: boolean;
  /** True when the nearest needed material is within scanner range. */
  hasSignal: boolean;
  /** Direction to the target, radians (world-space; +x right, +y down). */
  angle: number;
  /** Distance to the target in tiles. */
  distTiles: number;
  /** Which material the arrow is homing on. */
  material: "resonite" | "cryenite" | null;
}

export function scannerRangeTiles(game: Game): number {
  return SCANNER_RANGE[game.tiers.scanner - 1]!;
}

/** Compute the scanner read for this frame (specs/mining.md). */
export function computeScan(game: Game): ScanResult {
  const needResonite = game.satchel.resonite === 0 && !game.installed.has("guidance");
  const needCryenite = game.satchel.cryenite === 0 && !game.installed.has("thruster");
  const needed = needResonite || needCryenite;
  const base: ScanResult = { needed, hasSignal: false, angle: 0, distTiles: 0, material: null };
  if (!needed) return base;

  const mx = minerCenterX(game.miner);
  const my = minerCenterY(game.miner);
  let best: { dx: number; dy: number; d: number; material: "resonite" | "cryenite" } | null = null;
  for (const node of game.nodes) {
    if (node.collected) continue;
    if (node.material === "resonite" && !needResonite) continue;
    if (node.material === "cryenite" && !needCryenite) continue;
    const nx = tileLeft(node.col) + TILE_SIZE / 2;
    const ny = tileTop(node.row) + TILE_SIZE / 2;
    const dx = nx - mx;
    const dy = ny - my;
    const d = Math.hypot(dx, dy);
    if (!best || d < best.d) best = { dx, dy, d, material: node.material as "resonite" | "cryenite" };
  }
  if (!best) return base;

  const distTiles = best.d / TILE_SIZE;
  const range = scannerRangeTiles(game);
  return {
    needed: true,
    hasSignal: distTiles <= range,
    angle: Math.atan2(best.dy, best.dx),
    distTiles,
    material: best.material,
  };
}
