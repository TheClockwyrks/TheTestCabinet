// Arc Foundry — headless balance harness.
//
// Drives the exact game simulation from ../src, with no DOM, no rAF, and no rendering,
// as fast as the host CPU allows. A `Controller` scripts each build phase by calling
// ONLY the game's input-free control API (pullPress / placeStamp / combine / slag /
// sell / setTargeting / startWave / fixedStep, plus devPlace for the funded mechanics
// mode); the harness sends each wave and steps the fixed simulation to completion,
// gathering per-wave metrics. Because the sim is deterministic — the wave composition
// seeds itself per wave, and the scrap-press roll is seeded per MATCH here — a
// (controller, seed) pair maps to a single reproducible result, which is what makes it
// useful for balancing.
//
// GemTD twist (specs/build.md): the press roll is RANDOM (type + quality), so a single
// seed is not representative of how a controller plays. The harness reseeds the press
// per match (see newGame) and run.ts averages a controller over MANY seeds to report a
// WIN RATE. The --funded mode swaps the random press for exact devPlace placements to
// isolate the MECHANICS (geometry + the quality ladder) from the economy + the roll.
//
// Run the reports with:  npx tsx sim/run.ts   (and  --funded)

import {
  COMPONENT_ORDER,
  DIFFICULTY,
  FIXED_STEP,
  MAX_TIER,
  STAMP_COST,
  type DifficultyDef,
} from "../src/constants";
import { CAMPAIGN } from "../src/mode";
import { mapById } from "../src/constants";
import { Game } from "../src/sim";
import { Rng } from "../src/rng";
import type { Component, ComponentType, MapDef, Tier } from "../src/types";
import type { Anchor } from "./mazes";
import { mazeFor } from "./mazes";

export { FIXED_STEP, DIFFICULTY, mapById, COMPONENT_ORDER, MAX_TIER, STAMP_COST };
export type { DifficultyDef, ComponentType, Tier, Component, MapDef, Anchor };

// Build a fresh, started game on `map`/`diff` with its scrap-press reseeded to `seed`.
// The press field is private on Game (the browser uses one fixed seed), so the harness
// reaches past `private` to reseed it — the ONLY thing it varies per match, so that a
// controller's win rate reflects the random roll, not one lucky/unlucky pull sequence.
export function newGame(map: MapDef, diff: DifficultyDef, seed: number): Game {
  const g = new Game(CAMPAIGN, map, diff);
  g.start();
  (g as unknown as { press: Rng }).press = new Rng(seed >>> 0);
  return g;
}

// ---- Controller contract --------------------------------------------------------

// Per-build-phase context handed to a controller. `funded` selects the mechanics-only
// path (devPlace exact tiers, no roll, no cost); `anchors` is the map's planned maze;
// `rng` is the controller's OWN decision rng (seeded per match, kept apart from the
// game's press) for any tie-breaks so runs stay reproducible.
export interface BuildCtx {
  funded: boolean;
  wave: number; // the wave about to be launched (1..diff.waves)
  anchors: Anchor[];
  rng: Rng;
}

// A controller decides what to build each build phase. It is created fresh per match
// (so it may keep placement progress in closure state), and touches Game only through
// the input-free control API.
export interface Controller {
  name: string;
  note: string;
  build(game: Game, ctx: BuildCtx): void;
}

// ---- Placement helpers (drive the two build paths) ------------------------------

// Realistic path: pull the press (spends Charge + a stamp, HOLDS a random roll), then
// place the held stamp at the nearest legal anchor to `target`. Returns the placed
// component, or null (a roll that finds nowhere legal is cancelled — a wasted pull, as
// in real play). The controller does not choose the type/quality — the press does.
export function pullAndPlace(g: Game, target: Anchor): Component | null {
  const held = g.pullPress();
  if (!held) return null;
  const spot = g.board.nearestLegalAnchor(target.col, target.row, g.structures, g.units);
  if (!spot) {
    g.cancelHeld();
    return null;
  }
  return g.placeStamp(spot.col, spot.row);
}

// Funded path: place an EXACT (type, tier) at the nearest legal anchor to `target`,
// with no roll and no Charge (specs/build.md devPlace). Isolates mechanics.
export function devPlaceNear(g: Game, type: ComponentType, tier: Tier, target: Anchor): Component | null {
  return g.devPlace(type, tier, target.col, target.row);
}

export function activeComponents(g: Game): number {
  let n = 0;
  for (const s of g.structures) if (s.kind === "component") n++;
  return n;
}

// Combine matching pairs up the quality ladder, greedily. Combining is free and never
// seals (it frees a footprint), so it is geometrically safe — BUT every combine removes
// one wall from the maze (the consumed partner's footprint). In a GemTD you therefore
// combine only your SURPLUS: `floor` is the number of active components to KEEP as the
// wall skeleton — the climb stops once the board is down to that many. `only` restricts
// the climb to one component type (the lean variants). floor 0 climbs everything (used
// by no-maze, whose clump is not a maze anyway).
export function combineUp(g: Game, opts?: { floor?: number; only?: ComponentType }): void {
  const floor = opts?.floor ?? 0;
  let guard = 0;
  while (guard++ < 4000) {
    if (activeComponents(g) <= floor) break;
    let done = false;
    for (const s of g.structures) {
      if (s.kind !== "component" || s.tier >= MAX_TIER) continue;
      if (opts?.only && s.type !== opts.only) continue;
      if (g.combinePartnerOf(s)) {
        g.combine(s.id);
        done = true;
        break;
      }
    }
    if (!done) break;
  }
}

// The length (in logical px) of the shortest OPEN route a ground unit must walk through
// the full waypoint chain, given the current maze — the single number that says how well
// a controller has MAZED. A straight-through route is short; a good serpentine is many ×
// longer. Returns Infinity if some segment is (transiently) sealed.
export function chainPathLength(g: Game): number {
  const occ = g.board.occupancy(g.structures);
  const chain = g.board.chain;
  let total = 0;
  for (let i = 1; i < chain.length; i++) {
    const path = g.board.pathTiles(chain[i - 1]!, chain[i]!, occ);
    if (!path) return Infinity;
    for (let k = 1; k < path.length; k++) {
      total += Math.hypot(path[k]!.x - path[k - 1]!.x, path[k]!.y - path[k - 1]!.y);
    }
  }
  return total;
}

function meanTierOf(g: Game): number {
  let sum = 0;
  let n = 0;
  for (const s of g.structures) {
    if (s.kind !== "component") continue;
    sum += s.tier;
    n++;
  }
  return n ? sum / n : 0;
}

// ---- Match runner ---------------------------------------------------------------

export interface WaveResult {
  wave: number;
  integrityBefore: number;
  integrityAfter: number;
  leaked: number;
  chargeAfter: number;
  components: number; // active components on the board after the wave
  maxTier: number; // highest quality reached
  meanTier: number; // mean quality of active components (the real "did it climb" read)
  pathLen: number; // shortest chain route length in px (the "did it maze" read)
  kills: number;
  resolved: boolean; // false only if the per-wave step cap was hit
}

export interface MatchResult {
  controller: string;
  note: string;
  map: string;
  difficulty: string;
  seed: number;
  outcome: "victory" | "defeat";
  wavesCleared: number;
  reachedWave: number;
  integrityLeft: number;
  score: number;
  finalComponents: number; // active components at the end
  finalStructures: number; // components + slag walls (the whole maze)
  maxTier: number;
  meanTier: number; // mean quality of the final firing line
  finalPathLen: number; // final maze route length in px
  tierCounts: number[]; // index 1..5 → count of active components at that tier
  waves: WaveResult[];
}

function tierHistogram(g: Game): { counts: number[]; maxTier: number; active: number } {
  const counts = [0, 0, 0, 0, 0, 0];
  let maxTier = 0;
  let active = 0;
  for (const s of g.structures) {
    if (s.kind !== "component") continue;
    counts[s.tier]!++;
    active++;
    if (s.tier > maxTier) maxTier = s.tier;
  }
  return { counts, maxTier, active };
}

export interface MatchOpts {
  map: MapDef;
  diff: DifficultyDef;
  seed: number;
  funded?: boolean;
  maxWaveSeconds?: number;
}

export function runMatch(controller: Controller, opts: MatchOpts): MatchResult {
  const maxSteps = Math.round((opts.maxWaveSeconds ?? 120) / FIXED_STEP);
  const g = newGame(opts.map, opts.diff, opts.seed);
  const rng = new Rng((opts.seed ^ 0x9e3779b9) >>> 0);
  const anchors = mazeFor(opts.map.id);

  const waves: WaveResult[] = [];
  let outcome: "victory" | "defeat" = "defeat";

  for (let w = 1; w <= opts.diff.waves; w++) {
    if (opts.funded) g.devGrant(1e9, g.integrity); // unlimited Charge for the funded path

    controller.build(g, { funded: !!opts.funded, wave: w, anchors, rng });

    const integrityBefore = g.integrity;
    const killsBefore = g.kills;
    g.startWave();

    let steps = 0;
    while (g.state === "playing" && g.phase === "wave" && steps < maxSteps) {
      g.fixedStep(FIXED_STEP);
      steps++;
    }

    const hist = tierHistogram(g);
    waves.push({
      wave: w,
      integrityBefore,
      integrityAfter: g.integrity,
      leaked: integrityBefore - g.integrity,
      chargeAfter: Math.min(g.charge, 999999),
      components: hist.active,
      maxTier: hist.maxTier,
      meanTier: meanTierOf(g),
      pathLen: chainPathLength(g),
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

  const hist = tierHistogram(g);
  const wavesCleared = outcome === "victory" ? opts.diff.waves : Math.max(0, g.wave - 1);
  return {
    controller: controller.name,
    note: controller.note,
    map: opts.map.id,
    difficulty: opts.diff.key,
    seed: opts.seed,
    outcome,
    wavesCleared,
    reachedWave: g.wave,
    integrityLeft: Math.max(0, g.integrity),
    score: g.score,
    finalComponents: hist.active,
    finalStructures: g.structures.length,
    maxTier: hist.maxTier,
    meanTier: meanTierOf(g),
    finalPathLen: chainPathLength(g),
    tierCounts: hist.counts,
    waves,
  };
}

// ---- Aggregation over seeds -----------------------------------------------------

export interface Aggregate {
  controller: string;
  note: string;
  seeds: number;
  wins: number;
  winRate: number; // wins / seeds
  meanCleared: number;
  minCleared: number;
  maxCleared: number;
  meanIntegrity: number;
  meanTier: number; // mean of each match's mean firing-line tier (did it climb?)
  meanPathLen: number; // mean final maze length in px (did it maze?)
  meanScore: number;
  results: MatchResult[];
}

// Run one controller over a list of seeds and aggregate. `makeController` is a factory
// so each seed gets a FRESH controller (its placement progress must not leak between
// matches).
export function runOverSeeds(
  makeController: () => Controller,
  seeds: number[],
  base: Omit<MatchOpts, "seed">,
): Aggregate {
  const results: MatchResult[] = [];
  for (const seed of seeds) {
    results.push(runMatch(makeController(), { ...base, seed }));
  }
  const wins = results.filter((r) => r.outcome === "victory").length;
  const cleared = results.map((r) => r.wavesCleared);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  return {
    controller: results[0]!.controller,
    note: results[0]!.note,
    seeds: seeds.length,
    wins,
    winRate: wins / (seeds.length || 1),
    meanCleared: mean(cleared),
    minCleared: Math.min(...cleared),
    maxCleared: Math.max(...cleared),
    meanIntegrity: mean(results.map((r) => r.integrityLeft)),
    meanTier: mean(results.map((r) => r.meanTier)),
    meanPathLen: mean(results.map((r) => (isFinite(r.finalPathLen) ? r.finalPathLen : 0))),
    meanScore: mean(results.map((r) => r.score)),
    results,
  };
}
