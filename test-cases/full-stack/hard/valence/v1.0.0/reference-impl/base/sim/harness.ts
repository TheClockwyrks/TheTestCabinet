// Valence — headless balance harness.
//
// Drives the exact game simulation from ../src, with no DOM, no rAF, and no rendering,
// as fast as the host CPU allows. A `Controller` scripts the build phases (place/upgrade
// towers on grid cells); the harness sends each round and steps the fixed simulation to
// completion, gathering per-round metrics. The sim is deterministic (seeded waves, fixed
// spawn schedules), so a layout maps to a single reproducible result — which is what
// makes it useful for balancing.
//
// Run the reports with:  npx tsx sim/run.ts

import { FIXED_STEP, TOWERS, type Branch, type TowerKind } from "../src/constants";
import { CELLS, cellIdAt, type CellInfo } from "../src/board";
import { MODE } from "../src/mode";
import { Game } from "../src/sim";
import type { Tower } from "../src/types";

export function newGame(): Game {
  return new Game(MODE);
}

// ---- Board placement helpers (declarative layouts refer to world anchors) ------
export const buildable: CellInfo[] = CELLS.filter((c) => !c.blocked);

// The nearest buildable cell to a world point (for laying towers beside the lanes).
export function cellNear(x: number, y: number): number {
  let best = buildable[0]!;
  let bd = Infinity;
  for (const c of buildable) {
    const d = (c.cx - x) ** 2 + (c.cy - y) ** 2;
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best.id;
}

// A run of cells beside a horizontal lane segment: one cell per column across [x0,x1],
// offset to `y` (just off the track), nearest-buildable and de-duplicated in order.
export function laneCells(x0: number, x1: number, y: number): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (let x = x0; x <= x1; x += 40) {
    const id = cellNear(x, y);
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

// The board's named anchor rows (from src/board.ts geometry).
export const ANCHORS = {
  laneA: (): number[] => laneCells(170, 800, 145), // above Lane A (top run y≈185)
  laneAlow: (): number[] => laneCells(170, 800, 225),
  laneB: (): number[] => laneCells(170, 800, 655), // below Lane B (bottom run y≈615)
  laneBhigh: (): number[] => laneCells(170, 800, 575),
  sharedIn: (): number[] => laneCells(40, 130, 360).concat(laneCells(40, 130, 440)), // inlet approach
  sharedOut: (): number[] => laneCells(840, 950, 360).concat(laneCells(840, 950, 440)), // final run
};

// ---- Controllers ---------------------------------------------------------------
export interface BuildOrder {
  kind: TowerKind;
  cell: number;
  level?: 1 | 2 | 3; // upgrade target once affordable
  branch?: Branch; // required to reach level 3
  minRound?: number; // do not attempt before this round's build phase
}

export interface Controller {
  name: string;
  note?: string;
  build(game: Game, round: number): void;
}

// Apply a declarative layout with a simple greedy economy model: each build phase, in
// list order, place any not-yet-placed due+affordable order, then push affordable
// upgrades (cheapest-first) toward each order's target level/branch. A fair model of a
// player working a build list from the top.
export function layoutController(name: string, orders: BuildOrder[], note?: string): Controller {
  const placed = new Map<BuildOrder, Tower>();
  return {
    name,
    note,
    build(game, round) {
      for (const o of orders) {
        if (placed.has(o)) continue;
        if (o.minRound && round < o.minRound) continue;
        const t = game.place(o.cell, o.kind);
        if (t) placed.set(o, t);
      }
      let progressed = true;
      while (progressed) {
        progressed = false;
        const ups = [...placed.entries()]
          .filter(([o, t]) => t.level < (o.level ?? 1))
          .sort((a, b) => (game.upgradeCost(a[1]) ?? 1e9) - (game.upgradeCost(b[1]) ?? 1e9));
        for (const [o, t] of ups) {
          const br = t.level === 2 ? o.branch : undefined;
          if (t.level === 2 && !br) continue;
          if (game.upgrade(t, br)) {
            progressed = true;
            break;
          }
        }
      }
    },
  };
}

// ---- Match runner --------------------------------------------------------------
export interface RoundResult {
  round: number;
  integrityBefore: number;
  integrityAfter: number;
  leaked: number;
  energyAfter: number;
  towers: number;
  kills: number;
  resolved: boolean;
}

export interface MatchResult {
  controller: string;
  note?: string;
  outcome: "victory" | "defeat";
  roundsCleared: number;
  reachedRound: number;
  integrityLeft: number;
  score: number;
  finalEnergy: number;
  finalTowers: number;
  rounds: RoundResult[];
}

export function runMatch(controller: Controller, opts?: { maxRoundSeconds?: number; funded?: boolean }): MatchResult {
  const maxSteps = Math.round((opts?.maxRoundSeconds ?? 240) / FIXED_STEP);
  const g = newGame();
  g.start();

  const rounds: RoundResult[] = [];
  let outcome: "victory" | "defeat" = "defeat";

  for (let w = 1; w <= 20; w++) {
    if (opts?.funded) g.energy = 1e9;
    controller.build(g, w);

    const integrityBefore = g.integrity;
    const killsBefore = g.kills;
    g.startRound();

    let steps = 0;
    while (g.state === "playing" && g.phase === "round" && steps < maxSteps) {
      g.fixedStep(FIXED_STEP);
      steps++;
    }

    rounds.push({
      round: w,
      integrityBefore,
      integrityAfter: g.integrity,
      leaked: integrityBefore - g.integrity,
      energyAfter: Math.min(g.energy, 999999),
      towers: g.towers.size,
      kills: g.kills - killsBefore,
      resolved: steps < maxSteps,
    });

    if (g.state === "victory") {
      outcome = "victory";
      break;
    }
    if (g.state === "defeat") {
      outcome = "defeat";
      break;
    }
  }

  const roundsCleared = outcome === "victory" ? 20 : Math.max(0, g.round - 1);
  return {
    controller: controller.name,
    note: controller.note,
    outcome,
    roundsCleared,
    reachedRound: g.round,
    integrityLeft: Math.max(0, g.integrity),
    score: g.score,
    finalEnergy: g.energy > 999999 ? 0 : g.energy,
    finalTowers: g.towers.size,
    rounds,
  };
}

export { cellIdAt };
