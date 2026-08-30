// Arc Foundry — planned-maze GENERATOR for the balance harness.
//
// Arc Foundry is a GemTD reskin: every kept component AND every un-kept blocker is a 2×2 WALL, and
// the Load walks the shortest OPEN route through the map's ORDERED waypoint chain. The lever a good
// player pulls is GEOMETRY — wall the yard so the shortest route is forced to DETOUR back and forth,
// and because the route must visit the six waypoints IN ORDER, the same corridors are re-crossed on
// every one of the seven legs. A real GemTD maze folds the route many times over (a hand-built one
// on The Substation runs ~1790 tiles); a naive long snake that ignores the waypoint order barely
// reaches ~1.5×.
//
// The old planned maze was a fixed center-out COMB folding the route only ~1.4–1.8×, so the harness
// "competent" line under-mazed by ~4–6× and its balance bands were far too soft a read. This
// generator instead builds the layout in two robust passes, each measured against the game's real
// A* pathfinder:
//   1. BLOCKERS — from an empty board, greedily add the single legal wall that lengthens the
//      ordered-chain route the most, never sealing (devBlocker refuses/snaps a sealing wall). This
//      discovers the waypoint-boxing / forced-detour walls automatically and folds the route ~5–7×.
//   2. FIRING — reclassify the anchors that best COVER that route: a greedy SET-COVER that repeatedly
//      picks the wall whose tower range (COVER_R) adds the most previously-uncovered route length.
//      (Reclassifying a wall as a firing slot changes no geometry — both are 2×2 walls — so the fold
//      is preserved while the towers are placed where the Load actually spends its time under fire.)
//      Picking by coverage, not by raw length, is what a good player does: the towers line the hot
//      corridors instead of stringing thinly down an undefended maze.
//
// The result is baked to sim/planned-maze.ts (a fast, deterministic layout the harness fills each
// wave). Regenerate with:  npx tsx sim/genmaze.ts [--cap=N]

import { writeFileSync } from "node:fs";
import { DIFFICULTY, mapById, newGame, chainPathLength } from "./harness";
import { Game } from "../src/sim";
import type { Anchor } from "./mazes";

const TILE = 20;
const MAPS = ["substation", "switchyard", "transformer"] as const;
const CAP = Number(process.argv.find((a) => a.startsWith("--cap="))?.split("=")[1] ?? 160);
const FIRING_N = 26; // firing slots reserved as the tower line (the competent coverage ceiling)
const COVER_R = 120; // px — a tower's effective coverage radius (base 88–160, combos 108–190)

function lattice(): Anchor[] {
  const out: Anchor[] = [];
  for (let col = 0; col <= 48; col += 2) for (let row = 0; row <= 30; row += 2) out.push({ col, row });
  return out;
}
function footprintFree(g: Game, a: Anchor): boolean {
  const occ = g.board.occupancy(g.structures);
  for (const t of g.board.footprintTiles(a.col, a.row)) {
    if (!g.board.inBounds(t.col, t.row)) return false;
    if (occ[t.row * 50 + t.col]) return false;
  }
  return !g.board.footprintHitsWaypoint(a.col, a.row);
}
function anchorCenterPx(a: Anchor) { return { x: a.col * TILE + TILE, y: 56 + a.row * TILE + TILE }; }

// PASS 1 — greedily grow the longest-route maze; returns the ACTUAL snapped wall anchors placed.
function growLongest(mapId: string, cap: number): { placed: Anchor[]; tiles: number; bare: number } {
  const g = newGame(mapById(mapId)!, DIFFICULTY.hard);
  const bare = chainPathLength(g) / TILE;
  const placed: Anchor[] = [];
  const cands = lattice();
  while (placed.length < cap) {
    let best: Anchor | null = null;
    let bestLen = chainPathLength(g);
    const cur = bestLen;
    for (const a of cands) {
      if (!footprintFree(g, a)) continue;
      if (g.board.wouldSeal(a.col, a.row, g.structures, g.units)) continue;
      const b = g.devBlocker(a.col, a.row);
      if (!b) continue;
      const l = chainPathLength(g);
      g.structures = g.structures.filter((s) => s.id !== b.id);
      if (l > bestLen) { bestLen = l; best = { col: b.col, row: b.row }; }
    }
    if (!best || bestLen <= cur + 0.01) break;
    g.devBlocker(best.col, best.row);
    placed.push(best);
    if (placed.length % 20 === 0) console.log(`   ${mapId}: ${placed.length} walls, ${(chainPathLength(g) / TILE).toFixed(0)}t`);
  }
  return { placed, tiles: chainPathLength(g) / TILE, bare };
}

// The final route (densely sampled, px) for the placed maze — used to score tower coverage.
function sampledRoute(mapId: string, anchors: Anchor[]): { pts: { x: number; y: number }[]; segLen: number } {
  const g = newGame(mapById(mapId)!, DIFFICULTY.hard);
  for (const a of anchors) g.devBlocker(a.col, a.row);
  const path = g.mazePath();
  const pts: { x: number; y: number }[] = [];
  const STEP = 8; // px between samples
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!, b = path[i]!;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.round(d / STEP));
    for (let k = 0; k < n; k++) pts.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return { pts, segLen: STEP };
}

// PASS 2 — greedy SET-COVER: pick FIRING_N maze anchors whose COVER_R disc covers the most route
// samples. Each pick adds the anchor covering the most still-uncovered samples; the rest are blockers.
function splitByCoverage(mapId: string, anchors: Anchor[]): { firing: Anchor[]; blockers: Anchor[]; coveredT: number } {
  const { pts, segLen } = sampledRoute(mapId, anchors);
  const R2 = COVER_R * COVER_R;
  const covers = anchors.map((a) => {
    const c = anchorCenterPx(a);
    const set = new Set<number>();
    for (let i = 0; i < pts.length; i++) if ((pts[i]!.x - c.x) ** 2 + (pts[i]!.y - c.y) ** 2 <= R2) set.add(i);
    return set;
  });
  const covered = new Set<number>();
  const chosen = new Set<number>();
  for (let n = 0; n < Math.min(FIRING_N, anchors.length); n++) {
    let bestIdx = -1, bestGain = -1;
    for (let i = 0; i < anchors.length; i++) {
      if (chosen.has(i)) continue;
      let gain = 0;
      for (const p of covers[i]!) if (!covered.has(p)) gain++;
      if (gain > bestGain) { bestGain = gain; bestIdx = i; }
    }
    if (bestIdx < 0 || bestGain <= 0) break;
    chosen.add(bestIdx);
    for (const p of covers[bestIdx]!) covered.add(p);
  }
  const firing = [...chosen].map((i) => anchors[i]!);
  const blockers = anchors.filter((_, i) => !chosen.has(i));
  return { firing, blockers, coveredT: (covered.size * segLen) / TILE };
}

const out: Record<string, { firing: Anchor[]; blockers: Anchor[] }> = {};
const notes: string[] = [];
for (const m of MAPS) {
  console.log(`== ${m} (cap ${CAP}) ==`);
  const { placed, tiles, bare } = growLongest(m, CAP);
  const { firing, blockers, coveredT } = splitByCoverage(m, placed);
  out[m] = { firing, blockers };
  const note = `${m}: ${tiles.toFixed(0)}t route (${(tiles / bare).toFixed(1)}× bare ${bare.toFixed(0)}t), ~${coveredT.toFixed(0)}t covered by ${firing.length} towers + ${blockers.length} blockers`;
  notes.push(note);
  console.log(`   ${note}\n`);
}

const fmt = (as: Anchor[]) => as.map((a) => `[${a.col},${a.row}]`).join(", ");
const body = `// GENERATED by sim/genmaze.ts — do not edit by hand. Regenerate: npx tsx sim/genmaze.ts
//
// A per-map GemTD maze: a greedily-grown maximal-fold route (pass 1), with FIRING slots chosen by
// a greedy set-cover of that route (pass 2), the rest BLOCKER walls. See genmaze.ts for the method.
// Fold + coverage at generation:
${notes.map((n) => `//   ${n}`).join("\n")}
import type { Anchor } from "./mazes";

function pts(raw: number[][]): Anchor[] {
  return raw.map(([col, row]) => ({ col: col!, row: row! }));
}

export const PLANNED_MAZE: Record<string, { firing: Anchor[]; blockers: Anchor[] }> = {
${MAPS.map(
  (m) => `  ${m}: {
    firing: pts([${fmt(out[m]!.firing)}]),
    blockers: pts([${fmt(out[m]!.blockers)}]),
  },`,
).join("\n")}
};
`;
writeFileSync(new URL("./planned-maze.ts", import.meta.url), body);
console.log("wrote sim/planned-maze.ts");
export {};
