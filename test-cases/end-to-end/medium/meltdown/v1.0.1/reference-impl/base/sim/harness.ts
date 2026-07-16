// Meltdown — headless simulation harness.
//
// Drives the exact game simulation from ../src, with no DOM, no rAF, and no
// rendering, as fast as the host CPU allows. A `Controller` scripts the build
// phases (place/upgrade/sell towers); the harness sends each wave and steps the
// fixed simulation to completion, gathering per-wave metrics (leaks, trips, and
// how engaged the heat system was). Because the sim is fully deterministic
// (no RNG, fixed spawn schedules), a layout maps to a single reproducible result
// — which is what makes it useful for balancing.
//
// Run the reports with:  npx tsx sim/run.ts

import { FIXED_STEP, REDLINE, TILE } from "../src/constants";
import { Game } from "../src/game";
import { Input } from "../src/input";
import type { Tower } from "../src/towers";
import type { Rotation, TowerType } from "../src/types";

// The Game constructor wants an Input, and Input's constructor only stashes the
// canvas (it touches the DOM only in attach(), which we never call), so a null
// canvas is safe headless.
export function newGame(): Game {
  return new Game(new Input(null as unknown as HTMLCanvasElement));
}

// A build order in a declarative layout. `col,row` is the footprint's top-left
// tile (specs/playfield.md); `rot` turns the radiator faces.
export interface BuildOrder {
  type: TowerType;
  col: number;
  row: number;
  rot?: Rotation;
  level?: number; // upgrade target (2 or 3) once affordable
  minWave?: number; // do not attempt before this wave's build phase
}

// A controller decides what to build each build phase. `wave` is the wave about
// to be launched (1..20). `early` picks the wave-send timing model.
export interface Controller {
  name: string;
  note?: string;
  early?: boolean;
  build(game: Game, wave: number): void;
}

export interface WaveResult {
  wave: number;
  livesBefore: number;
  livesAfter: number;
  leaked: number;
  moneyAfter: number;
  emitters: number;
  towers: number;
  trips: number; // trip events during the wave
  plateauFrac: number; // mean fraction of wave-time each emitter spent at/over its redline
  heatFrac: number; // mean of each emitter's time-averaged H/100
  hotGunFrac: number; // fraction of emitters that reached their redline at some point
  peakHeat: number; // max H/100 seen on any emitter this wave
  resolved: boolean; // false only if the per-wave step cap was hit
}

export interface MatchResult {
  controller: string;
  note?: string;
  outcome: "victory" | "gameover";
  wavesCleared: number;
  reachedWave: number;
  livesLeft: number;
  score: number;
  finalMoney: number;
  finalTowers: number;
  kills: number;
  leaks: number;
  waves: WaveResult[];
}

// Apply a declarative layout with a simple economy model: each build phase, in
// list order, place any not-yet-placed order that is due (minWave) and
// affordable, then push affordable upgrades on placed towers. Greedy — it spends
// what it can, in priority order — which is a fair model of a player working a
// build list from the top.
export function layoutController(name: string, orders: BuildOrder[], opts?: { early?: boolean; note?: string }): Controller {
  const placed = new Map<BuildOrder, Tower>();
  return {
    name,
    note: opts?.note,
    early: opts?.early,
    build(game, wave) {
      // Placements first (they are also the walls that shape the maze).
      for (const o of orders) {
        if (placed.has(o)) continue;
        if (o.minWave && wave < o.minWave) continue;
        const t = game.build(o.type, o.col, o.row, o.rot ?? 0);
        if (t) placed.set(o, t);
      }
      // Then upgrades, cheapest-first so a build phase's money spreads out.
      let progressed = true;
      while (progressed) {
        progressed = false;
        const upgradable = [...placed.entries()]
          .filter(([o, t]) => (o.level ?? 1) > t.level)
          .sort((a, b) => game.upgradeCostOf(a[1]) - game.upgradeCostOf(b[1]));
        for (const [, t] of upgradable) {
          if (game.upgrade(t)) {
            progressed = true;
            break; // re-sort after each spend
          }
        }
      }
    },
  };
}

// Run one full match under a controller and return its per-wave metrics.
// `funded` gives the controller effectively unlimited money each build phase, so
// its full intended layout always lands — this isolates the mechanics (geometry,
// heat, roster) from the economy so the two can be balanced independently.
export function runMatch(controller: Controller, opts?: { maxWaveSeconds?: number; funded?: boolean }): MatchResult {
  const maxSteps = Math.round((opts?.maxWaveSeconds ?? 240) / FIXED_STEP);
  const g = newGame();
  g.beginMatch();

  const waves: WaveResult[] = [];
  let outcome: "victory" | "gameover" = "gameover";

  for (let w = 1; w <= 20; w++) {
    // Build phase for wave w (we are in "build" here; the harness never steps
    // the build-phase clock, so the controller's builds cost zero sim time).
    if (opts?.funded) g.money = 1e9;
    controller.build(g, w);

    const emitters = g.towers.filter((t) => t.isEmitter);
    const heatSum = new Map<Tower, number>();
    const plateauSum = new Map<Tower, number>();
    const peak = new Map<Tower, number>();
    const wasTripped = new Map<Tower, boolean>();
    for (const e of emitters) {
      heatSum.set(e, 0);
      plateauSum.set(e, 0);
      peak.set(e, e.heat);
      wasTripped.set(e, e.tripped);
    }
    let trips = 0;

    const livesBefore = g.lives;
    g.launchWave(controller.early ?? false);

    let steps = 0;
    while (g.state === "playing" && g.phase === "wave" && steps < maxSteps) {
      g.fixedStep(FIXED_STEP);
      steps++;
      for (const e of emitters) {
        heatSum.set(e, heatSum.get(e)! + e.heat);
        if (e.heat >= e.redline) plateauSum.set(e, plateauSum.get(e)! + 1);
        if (e.heat > peak.get(e)!) peak.set(e, e.heat);
        const prev = wasTripped.get(e)!;
        if (e.tripped && !prev) trips++;
        wasTripped.set(e, e.tripped);
      }
    }

    const denom = steps || 1;
    const nE = emitters.length || 1;
    let heatFrac = 0;
    let plateauFrac = 0;
    let hotGuns = 0;
    let peakHeat = 0;
    for (const e of emitters) {
      heatFrac += heatSum.get(e)! / denom / REDLINE;
      plateauFrac += plateauSum.get(e)! / denom;
      if (peak.get(e)! >= e.redline) hotGuns++;
      if (peak.get(e)! > peakHeat) peakHeat = peak.get(e)!;
    }

    waves.push({
      wave: w,
      livesBefore,
      livesAfter: g.lives,
      leaked: livesBefore - g.lives,
      moneyAfter: g.money,
      emitters: emitters.length,
      towers: g.towers.length,
      trips,
      plateauFrac: plateauFrac / nE,
      heatFrac: heatFrac / nE,
      hotGunFrac: hotGuns / nE,
      peakHeat: peakHeat / REDLINE,
      resolved: steps < maxSteps,
    });

    if (g.state === "victory") {
      outcome = "victory";
      break;
    }
    if (g.state === "gameover") {
      outcome = "gameover";
      break;
    }
    // Otherwise the game rolled into the next build phase; continue.
  }

  // On victory all 20 cleared; on game-over the wave in progress (reachedWave)
  // did not clear, so cleared = reachedWave - 1.
  const wavesCleared = outcome === "victory" ? 20 : Math.max(0, g.reachedWave - 1);

  return {
    controller: controller.name,
    note: controller.note,
    outcome,
    wavesCleared,
    reachedWave: g.reachedWave,
    livesLeft: Math.max(0, g.lives),
    score: g.score,
    finalMoney: g.money,
    finalTowers: g.towers.length,
    kills: g.kills,
    leaks: g.leakCount,
    waves,
  };
}

export { TILE };
