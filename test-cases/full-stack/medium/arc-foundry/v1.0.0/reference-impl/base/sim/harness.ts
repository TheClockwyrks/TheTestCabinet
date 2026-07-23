// Arc Foundry — headless balance harness (GemTD keep-one model).
//
// Drives the exact game simulation from ../src — no DOM, no rAF, no rendering — as fast as
// the host CPU allows, so a controller's play maps to a reproducible result. The game is a
// faithful GemTD reskin (specs/build.md): each build phase you place up to BUILDS_PER_LEVEL
// rocks that each roll a random type+quality ON PLACEMENT, you KEEP EXACTLY ONE per level as
// a firing component (or COMBINE a match to climb the quality ladder), and every rock you do
// not keep hardens into an inert BLOCKER — the maze. UPGRADE QUALITY (Refinement R0..8) buys
// better roll odds. Difficulty is wave count + enemy-HP scaling only.
//
// Modeling the roll deterministically. The interactive build path (pullPress/placeStamp)
// rolls off the game's private press RNG, so a single played match is one lucky/unlucky pull
// sequence — not a fair read on balance. The harness instead lays each strategy's INTENDED
// board with the game's deterministic dev helpers:
//   • the QUALITY roll is sampled HERE, per placement, from the REAL odds table
//     (QUALITY_ODDS_BY_R[R]) using the controller's own seeded rng — so averaging a
//     controller over many seeds (run.ts) reproduces the true roll distribution as a WIN
//     RATE, without depending on the game's internal press;
//   • the kept/combined firing component is planted with devPlace(type, tier) (exact, no
//     roll, no Charge) and the un-kept rocks with devBlocker (inert wall, no Charge);
//   • the CHARGE economy is modeled by the harness: the game credits kill bounties and the
//     wave-clear bonus itself (real income), and the controller DEBITS its own UPGRADE-QUALITY
//     and combo-upgrade spend from game.charge — placing rocks is FREE, so the only stamp limit
//     is the five-per-level allowance. A strategy therefore never cheats the economy or the roll.
//
// Because the sim is deterministic in (its wave seeds, the controller's decision rng), a
// (controller, seed) pair maps to a single reproducible result.
//
// Run the reports with:  npx tsx sim/run.ts

import {
  BUILDS_PER_LEVEL,
  COMBOS,
  COMBO_ORDER,
  COMPONENT_ORDER,
  DIFFICULTY,
  FIXED_STEP,
  MAX_COMBO_LEVEL,
  MAX_REFINEMENT,
  MAX_TIER,
  QUALITY_ODDS_BY_R,
  comboUpgradeCost,
  mapById,
  nextRefineCost,
  type DifficultyDef,
} from "../src/constants";
import { CAMPAIGN } from "../src/mode";
import { Game } from "../src/sim";
import { Rng } from "../src/rng";
import type { ComboType, Component, ComponentType, MapDef, Refinement, Tier } from "../src/types";
import type { Anchor } from "./mazes";

export { FIXED_STEP, DIFFICULTY, mapById, COMBOS, COMBO_ORDER, COMPONENT_ORDER, MAX_TIER, MAX_REFINEMENT, BUILDS_PER_LEVEL };
export type { DifficultyDef, ComboType, ComponentType, Tier, Refinement, Component, MapDef, Anchor };

// Build a fresh, started game on `map`/`diff`. The controller drives it only through the
// input-free control + dev API; the game seeds its own wave composition per wave, so the
// only per-match variation is the controller's decision rng (passed via BuildCtx).
export function newGame(map: MapDef, diff: DifficultyDef): Game {
  const g = new Game(CAMPAIGN, map, diff);
  g.start();
  return g;
}

// ---- Controller contract --------------------------------------------------------

// Per-build-phase context handed to a controller. `rng` is the controller's OWN decision
// rng (seeded per match) — used to sample the quality roll off the real odds table and for
// any tie-breaks, so a match is reproducible and a win rate averages the true roll spread.
export interface BuildCtx {
  wave: number; // the wave about to be launched (1..diff.waves)
  rng: Rng;
}

// A controller decides what to build each build phase. It is created fresh per match (so it
// may keep placement progress in closure state) and touches Game only through its control +
// dev API and the public `charge` / `structures` fields.
export interface Controller {
  name: string;
  note: string;
  build(game: Game, ctx: BuildCtx): void;
}

// ---- The modeled scrap-press roll (sampled off the REAL odds) -------------------

// Roll a rock's TYPE — uniform 12.5% each across the EIGHT base types (specs/build.md),
// independent of Refinement. COMPONENT_ORDER now carries choke / rectifier / regulator too, so
// sampling its length reproduces the 1/8 uniform draw without hardcoding.
export function rollType(rng: Rng): ComponentType {
  return COMPONENT_ORDER[Math.min(COMPONENT_ORDER.length - 1, Math.floor(rng.next() * COMPONENT_ORDER.length))]!;
}

// Roll a rock's QUALITY tier off the current Refinement odds (specs/build.md — UPGRADE
// QUALITY). Samples QUALITY_ODDS_BY_R[R] exactly, so the modeled roll IS the game's roll.
export function rollTier(rng: Rng, refinement: Refinement): Tier {
  const odds = QUALITY_ODDS_BY_R[refinement]!;
  let x = rng.next();
  for (let t = 1; t <= MAX_TIER; t++) {
    x -= odds[t - 1]!;
    if (x <= 0) return t as Tier;
  }
  return 1;
}

// ---- Board / economy helpers (shared by the strategies) -------------------------

export interface Roll {
  type: ComponentType;
  tier: Tier;
}

export function components(g: Game): Component[] {
  return g.structures.filter((s): s is Component => s.kind === "component");
}
export function activeComponents(g: Game): number {
  return components(g).length;
}

// A firing BASE component (a kept/climbed rock, not an assembled combination tower). These are
// the FEEDSTOCK the harness climbs and the ingredients a recipe consumes.
export function baseComponents(g: Game): Component[] {
  return components(g).filter((c) => !c.combo);
}
// The assembled COMBINATION TOWERS standing on the board.
export function comboComponents(g: Game): Array<Component & { combo: ComboType }> {
  return components(g).filter((c): c is Component & { combo: ComboType } => !!c.combo);
}
// How many DISTINCT combination-tower kinds a strategy has assembled (the combo-gate read: a
// competent late game reaches ≥1–2, a no-combo line reaches 0).
export function distinctComboCount(g: Game): number {
  const set = new Set<ComboType>();
  for (const c of comboComponents(g)) set.add(c.combo);
  return set.size;
}

// How many stamps this build phase gets: the flat 5-stamp allowance. Placing rocks is FREE
// (specs/build.md — the cap is five per level, and Charge is never spent on placement).
export function affordableStamps(_g: Game): number {
  return BUILDS_PER_LEVEL;
}

// Buy UPGRADE QUALITY levels the strategy can afford, up to a wave-scaled target R, keeping
// `reserve` Charge back for the level's other sinks (e.g. combo upgrades). One controller calls
// this at the top of its build phase (specs/build.md — the Refinement track).
export function buyRefinement(g: Game, targetR: number, reserve: number): void {
  while (g.refinement < Math.min(MAX_REFINEMENT, targetR)) {
    const cost = nextRefineCost(g.refinement);
    if (cost === null || g.charge - cost < reserve) break;
    g.charge -= cost;
    g.devSetRefinement((g.refinement + 1) as Refinement);
  }
}

// The best-COVERAGE firing anchor (the anchor list is coverage-ranked, best first) that is not
// already held by a firing component. It may currently hold a BLOCKER — an un-kept rock, or a slot
// freed by a merge / combo — and that is exactly the point: a real player STAMPS ONTO that blocker
// to reroll it into a tower (specs/build.md — "turn a wall you built earlier into a tower"), so the
// firing line always reclaims the best positions instead of marching outward to fresh, worse anchors
// (and, once a naive cursor wrapped, snapping towers to scattered tiles). Falls back to the last
// anchor if every slot is a live tower.
export function bestOpenFiringAnchor(g: Game, anchors: Anchor[]): Anchor | null {
  const taken = new Set(components(g).map((c) => `${c.col},${c.row}`));
  for (const a of anchors) if (!taken.has(`${a.col},${a.row}`)) return a;
  return anchors[anchors.length - 1] ?? null;
}

// Plant a firing component at `at`, RE-STAMPING any blocker already on that exact footprint (the
// stamp-onto-a-blocker reroll, specs/build.md — wall-neutral, the footprint stays walled, so the
// maze never opens a hole). Clearing the blocker first means the tower lands exactly here instead of
// devPlace snapping it away to a free tile. Returns the placed component, or null if nowhere legal.
export function placeFiringAt(g: Game, type: ComponentType, tier: Tier, at: Anchor): Component | null {
  g.structures = g.structures.filter((s) => !(s.kind === "blocker" && s.col === at.col && s.row === at.row));
  return g.devPlace(type, tier, at.col, at.row);
}

// Plant this level's kept firing component (an exact type+tier, no roll/Charge), re-stamping a
// blocker at `at` if one sits there (specs/build.md). Returns it, or null if nowhere legal.
export function keepComponent(g: Game, type: ComponentType, tier: Tier, at: Anchor): Component | null {
  return placeFiringAt(g, type, tier, at);
}

// Climb an EXISTING firing component of (type, tier) one rung in place — the model of a
// COMBINE that folds a freshly-rolled matching candidate into a standing component (the
// candidate is consumed, the component rises a tier; specs/build.md §4). Returns true if a
// match was found and climbed.
export function climbExisting(g: Game, type: ComponentType, tier: Tier): boolean {
  for (const c of components(g)) {
    if (c.type === type && c.tier === tier && c.tier < MAX_TIER) {
      c.tier = (c.tier + 1) as Tier;
      return true;
    }
  }
  return false;
}

// The value of building a carry of `type` at `tier`: higher tier first, then a preference for
// the AREA / CHAIN / status types — an Arc-Node's splash and a Coil's leaps at a high tier clear
// whole swarms, and a Rectifier's burn / Choke's slow add pressure a plain single-target line
// cannot, which is what makes trading breadth for a merged carry worth it (specs/towers.md §5.3).
// All EIGHT base types must appear (Record<ComponentType>). The Regulator never fires, so it
// scores as pure maze/support — the LOWEST carry value (you do not climb a non-firing node for
// DPS; its worth is the aura, handled where the maze is walled in).
const CARRY_TYPE_SCORE: Record<ComponentType, number> = {
  arcnode: 7,
  coil: 6,
  discharge: 5,
  rectifier: 4,
  choke: 3,
  emitter: 2,
  capacitor: 1,
  regulator: 0,
};
function carryScore(type: ComponentType, tier: Tier): number {
  return tier * 10 + CARRY_TYPE_SCORE[type];
}

// A pair of standing firing components of the same TYPE and TIER (tier < MAX) that could be
// COMBINEd — the classic GemTD merge that climbs the quality ladder off your OWN duplicates,
// independent of the roll. Returns the BEST such pair to fold (an AoE type at the highest tier
// available — see carryScore), or null.
export function duplicatePair(g: Game): { type: ComponentType; tier: Tier } | null {
  let best: { type: ComponentType; tier: Tier } | null = null;
  const seen = new Set<string>();
  for (const c of components(g)) {
    if (c.tier >= MAX_TIER) continue;
    const key = `${c.type}:${c.tier}`;
    if (seen.has(key)) {
      if (!best || carryScore(c.type, c.tier) > carryScore(best.type, best.tier)) best = { type: c.type, tier: c.tier };
    } else {
      seen.add(key);
    }
  }
  return best;
}

// COMBINE two standing duplicates of (type, tier): one rises a rung, the other's footprint is
// consumed and re-hardens into a BLOCKER (the maze keeps that wall). The GemTD climb that a
// good player leans on — it needs no lucky roll, only two matching towers — at the cost of one
// tower off the firing line (breadth-for-tier). Returns true if a pair was merged.
export function mergeDuplicate(g: Game, type: ComponentType, tier: Tier): boolean {
  let riser: Component | null = null;
  let victim: Component | null = null;
  for (const c of components(g)) {
    if (c.type !== type || c.tier !== tier || c.tier >= MAX_TIER) continue;
    if (!riser) riser = c;
    else if (!victim) {
      victim = c;
      break;
    }
  }
  if (!riser || !victim) return false;
  riser.tier = (riser.tier + 1) as Tier;
  g.structures = g.structures.filter((s) => s.id !== victim!.id);
  g.devBlocker(victim.col, victim.row); // the consumed footprint stays a wall
  return true;
}

// Drop an inert BLOCKER (an un-kept rock hardening into maze) at the nearest legal anchor to
// `at`, no Charge (specs/build.md — the maze material). Returns it, or null if nowhere legal.
export function layBlocker(g: Game, at: Anchor): boolean {
  return g.devBlocker(at.col, at.row) !== null;
}

// ---- Combination towers (specs/towers.md, specs/build.md — the redesign headline) ----------
//
// Base towers are now WEAK feedstock; the power comes from assembling COMBINATION TOWERS via a
// RECIPE (a multiset of base (type,tier) ingredients folds into one fixed, far stronger combo).
//
// The harness models a competent player ASSEMBLING a combo, but it does not book-keep the exact
// ingredient multiset a real recipe demands (which T5 arcnode etc. the player rolled/merged) —
// that would require replaying the whole random press. Instead the COST of a combo is modeled
// faithfully to the mechanic: a recipe CONSUMES ingredient structures off the board, each
// hardening into a blocker (wall-neutral). So assembling a combo eats `recipe.length − 1` of the
// firing line's WEAKEST base towers as feedstock (the initiator being the level's own harvest),
// then stands the combo up with the deterministic `devPlaceCombo`, whose stats are EXACT once
// placed (the real sim fires it with its real splash/burn/crit/multishot/aura). The abstraction
// is only in WHICH ingredients were spent and WHEN a player could afford the high-tier ones —
// paced by the strategy's combo schedule and gated on having the feedstock to spend.

// The `k` weakest firing BASE towers (lowest carryScore = lowest tier, then least-useful type),
// the ones a competent player would feed into a recipe first. Returns fewer than k if the line
// is not yet that wide.
export function weakestBaseComponents(g: Game, k: number): Component[] {
  return baseComponents(g)
    .slice()
    .sort((a, b) => carryScore(a.type, a.tier) - carryScore(b.type, b.tier))
    .slice(0, Math.max(0, k));
}

// The centroid (in tile space) of every firing structure — the "cluster center" the folded route
// re-crosses. A combo, the strongest unit on the board, wants to sit as close to this as possible.
function firingCentroid(g: Game): { col: number; row: number } | null {
  const cs = components(g);
  if (cs.length === 0) return null;
  return {
    col: cs.reduce((a, c) => a + c.col, 0) / cs.length,
    row: cs.reduce((a, c) => a + c.row, 0) / cs.length,
  };
}

// The base tower nearest the firing centroid — the most CENTRAL slot, where the route passes most.
// A good player initiates a recipe combine from a tower like this (the combo lands at the initiator's
// footprint, specs/towers.md), so the combo inherits a prime position rather than an outlying one.
export function centralBaseComponent(g: Game): Component | null {
  const c = firingCentroid(g);
  const bases = baseComponents(g);
  if (!c || bases.length === 0) return null;
  return bases.reduce((best, b) =>
    (b.col - c.col) ** 2 + (b.row - c.row) ** 2 < (best.col - c.col) ** 2 + (best.row - c.row) ** 2 ? b : best,
  );
}

// Assemble a combination tower, mirroring the real combineRecipeNow (src/sim.ts): the combo lands
// at the INITIATOR's footprint and every OTHER consumed ingredient hardens into a blocker in place
// (wall-neutral). `initiator` is the tower the combo replaces — pass the most CENTRAL ingredient so
// the strongest unit takes the prime slot (not a fresh anchor marching outward, the old bug); the
// `others` are the extra recipe feedstock spent as blockers. Returns true if the combo landed.
export function assembleCombo(g: Game, combo: ComboType, initiator: Component, others: Component[]): boolean {
  for (const ing of others) {
    if (ing.id === initiator.id) continue;
    g.structures = g.structures.filter((s) => s.id !== ing.id);
    g.devBlocker(ing.col, ing.row); // the spent ingredient's footprint stays a wall
  }
  // Free the initiator's footprint, then stand the combo up exactly there (it replaces the tower).
  const at = { col: initiator.col, row: initiator.row };
  g.structures = g.structures.filter((s) => s.id !== initiator.id);
  return g.devPlaceCombo(combo, at.col, at.row) !== null; // lands at UPGRADE LEVEL 0 (weak)
}

// UPGRADE the standing COMBINATION TOWERS with spare Charge (specs/towers.md). A combo lands at
// level 0 (weakened) and CLIMBS with Charge, so a competent player pumps kill income back into
// its combos — the softened spike + the gold sink. Round-robins the cheapest available upgrade
// so a wide combo line levels evenly, keeping `reserve` Charge back for the level's other sinks.
export function upgradeCombos(g: Game, reserve: number): void {
  for (;;) {
    let acted = false;
    for (const c of comboComponents(g)) {
      if (c.comboLevel >= MAX_COMBO_LEVEL) continue;
      const cost = comboUpgradeCost(c.combo, c.comboLevel);
      if (cost === null || g.charge - cost < reserve) continue;
      g.charge -= cost;
      c.comboLevel = Math.min(MAX_COMBO_LEVEL, c.comboLevel + 1);
      acted = true;
    }
    if (!acted) break;
  }
}

// Point Discharge Rigs at the STRONGEST unit (anti-tank / boss); everything else keeps FIRST
// (furthest along the chain), the best anti-leak default (specs/towers.md, specs/controls.md).
export function retarget(g: Game): void {
  for (const c of components(g)) {
    if (c.type === "discharge") g.setTargeting(c, "strongest");
  }
}

// The length (logical px) of the shortest OPEN route a ground unit walks through the full
// waypoint chain given the current maze — the single number that says how well a controller
// MAZED. A straight route is short; a good serpentine is many × longer. Infinity if a
// segment is (transiently) sealed.
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

// The mean quality of the BASE firing line (combos are single-grade / terminal, so their
// sentinel tier does not describe "how far the ladder climbed").
function meanTierOf(g: Game): number {
  const cs = baseComponents(g);
  if (cs.length === 0) return 0;
  return cs.reduce((a, c) => a + c.tier, 0) / cs.length;
}

// ---- Match runner ---------------------------------------------------------------

export interface WaveResult {
  wave: number;
  integrityBefore: number;
  integrityAfter: number;
  leaked: number;
  chargeAfter: number;
  refinement: number;
  components: number; // active firing components after the wave
  maxTier: number;
  meanTier: number;
  pathLen: number; // shortest chain route length in px (the "did it maze" read)
  combos: number; // combination towers standing after the wave
  distinctCombos: number; // distinct combo KINDS assembled (the "did it combine" read)
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
  finalRefinement: number;
  finalComponents: number; // firing components at the end
  finalStructures: number; // components + blockers (the whole maze)
  maxTier: number;
  meanTier: number; // mean quality of the final firing line (base towers)
  finalPathLen: number;
  finalCombos: number; // combination towers standing at the end
  distinctCombos: number; // distinct combo KINDS assembled over the run (0 for a no-combo line)
  tierCounts: number[]; // index 1..5 → count of firing BASE components at that tier
  waves: WaveResult[];
}

// Tier histogram over the BASE firing line (combos excluded — they carry no quality tier). The
// combination towers are tallied separately (comboComponents / distinctComboCount).
function tierHistogram(g: Game): { counts: number[]; maxTier: number; active: number } {
  const counts = [0, 0, 0, 0, 0, 0];
  let maxTier = 0;
  let active = 0;
  for (const c of baseComponents(g)) {
    counts[c.tier]!++;
    active++;
    if (c.tier > maxTier) maxTier = c.tier;
  }
  return { counts, maxTier, active };
}

export interface MatchOpts {
  map: MapDef;
  diff: DifficultyDef;
  seed: number;
  maxWaveSeconds?: number;
}

export function runMatch(controller: Controller, opts: MatchOpts): MatchResult {
  // The per-wave step cap must accommodate the LONGEST thing that can happen in a wave on the
  // CURRENT maze: a slow unit (or the campaign Dynamo) crawling the whole folded route, and — on
  // the final wave — the invincible post-final Overload Dynamo walking the maze once to tally the
  // Maze Rating (specs/enemies.md, specs/gameplay.md). A real GemTD maze folds the route many times
  // over (hundreds–thousands of tiles), so a FLAT cap silently times out that finale and misreads
  // a WON run as a defeat. The cap therefore SCALES with the maze length (recomputed each wave as
  // the walls rise): allow a full crawl at ~30 px/s plus a spawn/kill buffer, floored at 240 s. An
  // explicit opts.maxWaveSeconds overrides the scaling (used by tests).
  const capSecondsFor = (pathPx: number): number =>
    opts.maxWaveSeconds ?? Math.max(240, (Number.isFinite(pathPx) ? pathPx : 0) / 30 + 150);
  const g = newGame(opts.map, opts.diff);
  const rng = new Rng((opts.seed ^ 0x9e3779b9) >>> 0);

  const waves: WaveResult[] = [];
  let outcome: "victory" | "defeat" = "defeat";

  for (let w = 1; w <= opts.diff.waves; w++) {
    controller.build(g, { wave: w, rng });

    const integrityBefore = g.integrity;
    const killsBefore = g.kills;
    g.startWave();

    // Cap this wave against the maze as it now stands (a full folded-route crawl + the finale).
    const maxSteps = Math.round(capSecondsFor(chainPathLength(g)) / FIXED_STEP);
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
      chargeAfter: Math.round(g.charge),
      refinement: g.refinement,
      components: hist.active,
      maxTier: hist.maxTier,
      meanTier: meanTierOf(g),
      pathLen: chainPathLength(g),
      combos: comboComponents(g).length,
      distinctCombos: distinctComboCount(g),
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
    score: g.mazeRating, // the run's only end-number is the Maze Rating (0 on a defeat)
    finalRefinement: g.refinement,
    finalComponents: hist.active,
    finalStructures: g.structures.length,
    maxTier: hist.maxTier,
    meanTier: meanTierOf(g),
    finalPathLen: chainPathLength(g),
    finalCombos: comboComponents(g).length,
    distinctCombos: distinctComboCount(g),
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
  meanRefinement: number;
  meanComponents: number;
  meanTier: number; // mean of each match's mean base firing-line tier (did it climb?)
  meanPathLen: number; // mean final maze length in px (did it maze?)
  meanCombos: number; // mean combination towers standing at the end (did it combine?)
  meanDistinctCombos: number; // mean distinct combo kinds assembled (the combo-gate read)
  meanScore: number;
  results: MatchResult[];
}

// Run one controller over a list of seeds and aggregate. `makeController` is a factory so
// each seed gets a FRESH controller (placement progress must not leak between matches).
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
    meanRefinement: mean(results.map((r) => r.finalRefinement)),
    meanComponents: mean(results.map((r) => r.finalComponents)),
    meanTier: mean(results.map((r) => r.meanTier)),
    meanPathLen: mean(results.map((r) => (isFinite(r.finalPathLen) ? r.finalPathLen : 0))),
    meanCombos: mean(results.map((r) => r.finalCombos)),
    meanDistinctCombos: mean(results.map((r) => r.distinctCombos)),
    meanScore: mean(results.map((r) => r.score)),
    results,
  };
}
