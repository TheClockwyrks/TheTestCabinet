// Deepcore — the scanner (specs/mining.md).
//
// It points at the buried material node the miner still needs, and never at the Core.
// The lock holds only while the node is within the tier's range, measured in tiles as
// the straight-line distance between the miner's cell and the node's cell.

import { SCANNER_RANGE } from "./constants";
import { minerCol, minerRow } from "./physics";
import type { Game } from "./game";

export interface ScanResult {
  /** True while a needed node is within range. */
  locked: boolean;
  /** Which material the lock is on. */
  target: "resonite" | "cryenite" | null;
  /** A unit direction from the miner's cell to the node's. */
  dirX: number;
  dirY: number;
  /** The distance in tiles, or null while nothing is locked. */
  distanceTiles: number | null;
}

const NO_LOCK: ScanResult = {
  locked: false,
  target: null,
  dirX: 0,
  dirY: 0,
  distanceTiles: null,
};

/** The scanner's range in tiles at the miner's current tier. */
export function scannerRangeTiles(game: Game): number {
  return SCANNER_RANGE[game.tiers.scanner - 1] ?? 0;
}

/** Read the scanner as it stands. Pure: it changes nothing. */
export function computeScan(game: Game): ScanResult {
  // Tier 1 is no scanner at all, so nothing locks and nothing is shown.
  const range = scannerRangeTiles(game);
  if (range <= 0) return NO_LOCK;

  const needResonite = game.satchel.resonite === 0;
  const needCryenite = game.satchel.cryenite === 0;
  if (!needResonite && !needCryenite) return NO_LOCK;

  const col = minerCol(game.miner);
  const row = minerRow(game.miner);
  let best: {
    dx: number;
    dy: number;
    d: number;
    material: "resonite" | "cryenite";
  } | null = null;
  for (const node of game.nodes) {
    if (node.collected) continue;
    if (node.material === "resonite" && !needResonite) continue;
    if (node.material === "cryenite" && !needCryenite) continue;
    const dx = node.col - col;
    const dy = node.row - row;
    const d = Math.hypot(dx, dy);
    if (!best || d < best.d) best = { dx, dy, d, material: node.material };
  }
  if (!best || best.d > range) return NO_LOCK;

  const inv = best.d > 0 ? 1 / best.d : 0;
  return {
    locked: true,
    target: best.material,
    dirX: best.dx * inv,
    dirY: best.dy * inv,
    distanceTiles: best.d,
  };
}
