// Deepcore — the scanner (specs/mining.md).
//
// It points at the buried material node the miner still needs, and never at the
// Core. The lock holds only while the node is within the tier's range, measured
// in tiles as the straight-line distance between the miner's cell and the node's
// cell.

import type { MaterialId } from "./constants";
import type {
  MaterialNode,
  Miner,
  ScanResult,
  Satchel,
  UpgradeTiers,
} from "./game";
import { scannerRangeTiles } from "./figures";
import { minerCol, minerRow } from "./physics";

/** Nothing locked: the indicator is hidden and the readout reports nothing. */
export const NO_LOCK: ScanResult = {
  locked: false,
  target: null,
  dirX: 0,
  dirY: 0,
  distanceTiles: null,
};

/** Read the scanner as it stands. Pure: it changes nothing. */
export function computeScan(
  miner: Miner,
  nodes: readonly MaterialNode[],
  satchel: Satchel,
  tiers: UpgradeTiers,
): ScanResult {
  // The first tier is no scanner at all, so nothing locks and nothing is shown.
  const range = scannerRangeTiles(tiers);
  if (range <= 0) return NO_LOCK;

  const needResonite = satchel.resonite === 0;
  const needCryenite = satchel.cryenite === 0;
  if (!needResonite && !needCryenite) return NO_LOCK;

  const col = minerCol(miner);
  const row = minerRow(miner);
  let best: {
    dx: number;
    dy: number;
    d: number;
    material: MaterialId;
  } | null = null;
  for (const node of nodes) {
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
