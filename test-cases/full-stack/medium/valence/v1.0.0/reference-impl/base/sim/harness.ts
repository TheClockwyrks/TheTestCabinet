// Valence — headless balance harness.
//
// Drives the exact game simulation from ../src, with no DOM, no rAF, and no rendering,
// as fast as the host CPU allows. A `Controller` scripts the build phases (freely place /
// upgrade towers at world anchors); the harness sends each round and steps the fixed
// simulation to completion, gathering per-round metrics. The sim is deterministic (seeded
// waves, fixed spawn schedules), so a layout maps to a single reproducible result — which
// is what makes it useful for balancing. The battery runs on the MEDIUM branching map
// (JUNCTION: a fork into two lanes sharing an inlet trunk and a final run), so the
// coverage goals (one-lane must leak, shared-run towers cover both) apply.
//
// Run the reports with:  npx tsx sim/run.ts

import { FIXED_STEP, TOTAL_ROUNDS, TOWERS, type Branch, type TowerKind } from "../src/constants";
import { mapById, type Pt } from "../src/board";
import { MODE } from "../src/mode";
import { Game } from "../src/sim";
import type { Tower } from "../src/types";

const SIM_MAP = mapById("junction");

export function newGame(): Game {
  return new Game(MODE, SIM_MAP);
}

// ---- Board placement helpers (declarative layouts refer to world anchors) ------
// A row of world points just off a horizontal lane run: one point every `step` px across
// [x0,x1] at height `y`. Free placement snaps each to the nearest legal spot (Board.nearestLegal).
function row(x0: number, x1: number, y: number, step = 40): Pt[] {
  const out: Pt[] = [];
  for (let x = x0; x <= x1; x += step) out.push({ x, y });
  return out;
}

// JUNCTION's named anchor rows (its top lane runs y≈150, bottom lane y≈626, and both the
// inlet trunk and final run sit at y≈388 — see src/board.ts).
export const ANCHORS = {
  laneA: (): Pt[] => row(190, 780, 112), // above the top lane
  laneAlow: (): Pt[] => row(190, 780, 200), // below the top lane (between the lanes)
  laneB: (): Pt[] => row(190, 780, 664), // below the bottom lane
  laneBhigh: (): Pt[] => row(190, 780, 576), // above the bottom lane
  sharedIn: (): Pt[] => row(40, 120, 352).concat(row(40, 120, 424)), // inlet trunk (both lanes)
  sharedOut: (): Pt[] => row(856, 960, 352).concat(row(856, 960, 424)), // final run (both lanes)
};

// ---- Controllers ---------------------------------------------------------------
export interface BuildOrder {
  kind: TowerKind;
  at: Pt; // world anchor to place near (free placement snaps to nearest legal)
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
        const t = game.placeNear(o.at.x, o.at.y, o.kind);
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

  for (let w = 1; w <= TOTAL_ROUNDS; w++) {
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
      towers: g.towers.length,
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

  const roundsCleared = outcome === "victory" ? TOTAL_ROUNDS : Math.max(0, g.round - 1);
  return {
    controller: controller.name,
    note: controller.note,
    outcome,
    roundsCleared,
    reachedRound: g.round,
    integrityLeft: Math.max(0, g.integrity),
    score: g.score,
    finalEnergy: g.energy > 999999 ? 0 : g.energy,
    finalTowers: g.towers.length,
    rounds,
  };
}
