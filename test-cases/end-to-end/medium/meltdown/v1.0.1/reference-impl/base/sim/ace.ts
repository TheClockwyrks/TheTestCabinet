// Meltdown — "ace": a competent, economically-sane reference player used as the
// balance goalpost. It grows a maze around the centre crossing (where the L->R
// and T->B streams both pass, so its guns are fed by both), runs those guns hot,
// and answers each wave's mix with specialists. The `managed` flag toggles heat
// play: when true it rotates wall guns' radiators into the open lanes and threads
// Sinks so the fed core holds its plateau; when false it leaves them solid and
// sink-less so they bake and trip — the "ignored the heat" control.
//
// Spending is greedy in strict priority order each build phase (build/upgrade the
// most important affordable thing first), which models a player working a plan
// from the top without scattering money.

import { Game } from "../src/game";
import type { Tower } from "../src/towers";
import type { Rotation, TowerType } from "../src/types";
import type { Controller } from "./harness";

interface Step {
  key: string;
  type: TowerType;
  col: number;
  row: number;
  rot?: Rotation;
  level?: number; // upgrade target
  minWave?: number;
}

// The plan: an ordered list of build/upgrade steps. Earlier = higher priority.
function plan(managed: boolean): Step[] {
  const wallRot: Rotation = managed ? 1 : 0; // rot 1 aims Arc N/S radiators E/W (into the vertical lanes)
  const s: Step[] = [];
  let n = 0;
  const add = (type: TowerType, col: number, row: number, opts: Partial<Step> = {}) => {
    s.push({ key: `${type}${n++}`, type, col, row, ...opts });
  };

  // --- The maze: a 3-tooth vertical comb that snakes the L->R stream up/down
  // across the whole floor, so a unit walking it passes EVERY tooth's guns and
  // keeps them fed (and its guns also range over the T->B stream crossing the
  // centre). Teeth alternate a bottom/top gap. Cells are emitted round-robin so a
  // partial (early) build already spreads coverage across all three teeth. ---
  const teeth: Array<{ col: number; r0: number; r1: number }> = [
    { col: 14, r0: 0, r1: 25 }, // gap bottom (rows 26..35)
    { col: 22, r0: 10, r1: 35 }, // gap top (rows 0..9)
    { col: 30, r0: 0, r1: 25 }, // gap bottom
  ];
  const cellLists = teeth.map((t) => {
    const cells: number[] = [];
    for (let r = t.r0; r + 1 <= t.r1; r += 2) cells.push(r);
    return cells;
  });
  const maxLen = Math.max(...cellLists.map((c) => c.length));
  let sinkTick = 0;
  for (let k = 0; k < maxLen; k++) {
    teeth.forEach((t, ti) => {
      const rows = cellLists[ti];
      if (k >= rows.length) return;
      const r = rows[k];
      // Thread a Sink roughly every 3rd cell when managing heat (interior cells),
      // so the boxed-in guns hold their plateau instead of tripping.
      const interior = r >= 4 && r <= t.r1 - 4;
      const isSink = managed && interior && sinkTick++ % 3 === 2;
      add(isSink ? "sink" : "arc", t.col, r, { rot: isSink ? 0 : wallRot, minWave: k < 8 ? 1 : 2 });
    });
  }

  // --- Splash just inside the corridor for Swarms (wave 4+). ---
  add("bloom", 8, 15, { rot: wallRot, minWave: 4 });

  // --- Air cover on the flight lines (wave 5+). ---
  add("flak", 14, 24, { level: 2, minWave: 5 });
  add("flak", 36, 12, { level: 2, minWave: 5 });
  add("flak", 36, 26, { level: 2, minWave: 7 });

  // --- Upgrade the fed comb Arcs to II then III (they run hot -> huge damage). ---
  for (const col of [14, 22, 30]) for (let r = 10; r + 1 <= 25; r += 2) add_upgrade(s, `arc-up-${col}-${r}`, col, r, 2, 5);
  for (const col of [14, 22, 30]) for (let r = 10; r + 1 <= 25; r += 2) add_upgrade(s, `arc-up3-${col}-${r}`, col, r, 3, 8);

  // --- Core-breaker: a tucked Lance fed by a Forge for the boss waves. ---
  add("lance", 38, 14, { rot: 2, level: 3, minWave: 8 });
  add("forge", 36, 15, { level: 3, minWave: 8 });

  // --- A cold Rime just before the corridor to slow Sprints (wave 3+). ---
  add("rime", 8, 20, { rot: 0, level: 2, minWave: 3 });
  if (managed) add("sink", 8, 22, { minWave: 4 });

  // --- Bloom upgrades and a second Bloom for the late swarm floods. ---
  add_upgrade(s, "bloom-up", 8, 15, 3, 10);
  add("bloom", 8, 22, { rot: wallRot, level: 3, minWave: 12 });

  // --- Late-game expansion (waves 11+): a 4th tooth deepens the maze and adds a
  // fed gun bank; more air cover, a second core-breaker, and (when managing) more
  // Sinks so the deepened core holds. A well-off player keeps spending. ---
  const t4r0 = 10, t4r1 = 35; // gap top, mirrors tooth 2
  let s4 = 0;
  for (let r = t4r0; r + 1 <= t4r1; r += 2, s4++) {
    const interior = r >= 14 && r <= 31;
    const isSink = managed && interior && s4 % 3 === 2;
    add(isSink ? "sink" : "arc", 38, r, { rot: isSink ? 0 : wallRot, level: isSink ? 3 : 3, minWave: 11 });
  }
  add("flak", 44, 18, { level: 3, minWave: 11 });
  add("flak", 44, 8, { level: 3, minWave: 13 });
  add("lance", 42, 22, { rot: 2, level: 3, minWave: 14 });
  add("forge", 40, 23, { level: 3, minWave: 14 });
  add_upgrade(s, "rime-up3", 8, 20, 3, 12);
  // Extra Sinks laid into the open lane beside the hottest wall guns (managed).
  if (managed) {
    for (const [col, row] of [[16, 16], [24, 16], [16, 20], [24, 20], [32, 16], [32, 20]] as const) {
      add("sink", col, row, { minWave: 12 });
    }
  }

  return s;
}

// A pseudo-step that means "upgrade the tower at (col,row) to `level`". We encode
// it as a step with a sentinel type; the runner resolves it against placed towers.
function add_upgrade(s: Step[], key: string, col: number, row: number, level: number, minWave: number): void {
  s.push({ key, type: "__upgrade__" as TowerType, col, row, level, minWave });
}

export function aceController(managed: boolean): Controller {
  const steps = plan(managed);
  const placed = new Map<string, Tower>(); // key -> tower
  const byCell = new Map<string, Tower>(); // "col,row" -> tower (for upgrades)
  const doneUpgrade = new Set<string>();

  return {
    name: managed ? "ace-managed" : "ace-ignored",
    note: managed ? "competent maze + heat mgmt" : "same maze, heat IGNORED (solid, no sinks)",
    early: true,
    build(game: Game, wave: number) {
      // Greedy in priority order; each phase, execute affordable steps top-down.
      for (const st of steps) {
        if (st.minWave && wave < st.minWave) continue;

        if ((st.type as string) === "__upgrade__") {
          if (doneUpgrade.has(st.key)) continue;
          const t = byCell.get(`${st.col},${st.row}`);
          if (!t) continue; // not built yet
          if (t.level >= (st.level ?? t.level)) {
            doneUpgrade.add(st.key);
            continue;
          }
          if (game.upgrade(t) && t.level >= (st.level ?? 0)) doneUpgrade.add(st.key);
          continue;
        }

        if (placed.has(st.key)) {
          // Already built; pursue its own upgrade target if any.
          const t = placed.get(st.key)!;
          if (st.level && t.level < st.level) game.upgrade(t);
          continue;
        }
        const t = game.build(st.type, st.col, st.row, st.rot ?? 0);
        if (t) {
          placed.set(st.key, t);
          byCell.set(`${st.col},${st.row}`, t);
          if (st.level && t.level < st.level) game.upgrade(t);
        }
      }

      // Surplus pass: a well-off player doesn't sit on money — max out every
      // placed tower (cheapest upgrade first) with whatever is left over.
      let progressed = true;
      while (progressed) {
        progressed = false;
        const ups = [...placed.values()]
          .filter((t) => t.level < 3)
          .sort((a, b) => game.upgradeCostOf(a) - game.upgradeCostOf(b));
        for (const t of ups) {
          if (game.upgrade(t)) {
            progressed = true;
            break;
          }
        }
      }
    },
  };
}
