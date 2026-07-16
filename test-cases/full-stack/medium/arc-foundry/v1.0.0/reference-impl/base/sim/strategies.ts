// Arc Foundry — the controller battery run.ts drives for the balance goal checks.
//
// Each controller plays a faithful GemTD loop through the harness model (specs/build.md):
// every build phase it may place up to BUILDS_PER_LEVEL rocks, KEEP EXACTLY ONE as a firing
// component (or COMBINE a match to climb a rung, or ASSEMBLE a COMBINATION TOWER from a recipe),
// and the rest harden into inert BLOCKERS — the maze. In the redesign, base towers are WEAK
// FEEDSTOCK: the levers a good player pulls are GEOMETRY (fold the shortest open route into a
// long serpentine so the Load crawls past the guns), the QUALITY LADDER + UPGRADE QUALITY (so a
// few carries climb the steep-damage rungs), and above all COMBINATION TOWERS (recipe merges that
// fold feedstock into the far-stronger combos that carry the scaled late waves). The strategies
// isolate those levers — each differs from competent by exactly one — so the win rates pin what
// "balanced" means:
//
//   • naive       — keep a roll a level; no maze, no climb, no refine, no combos (a route-less  LOSE
//                    blob of Scrap guns). Leaks overwhelm. The floor.
//   • no-maze     — climb + refine + assemble combos, but dump the walls into the guns so the   LOSE
//                    route never folds. Isolates GEOMETRY: DPS with no coverage.
//   • no-refine   — full maze + climb + combos, but never buy UPGRADE QUALITY, so its base      LOSE
//                    rolls stay Scrap and the feedstock the combos fold in is too weak.
//   • no-combo    — full maze + climb the quality ladder + refine, but NEVER assembles a        LOSE
//                    combination tower. Reaches Tesla-Prime BASE carries yet still struggles:
//                    combining is now a HARD GATE, not an edge — base towers alone can't carry
//                    the scaled late waves (reaches 0 combos vs competent's ≥1–2).
//   • competent   — the reference good player: full maze, refine on a schedule, climb duplicate  WIN
//                    carries, and ASSEMBLE combination towers on a cadence; targets the heavy rigs.
//
// The combo model is an ABSTRACTION (see sim/harness.ts): the harness does not book-keep the
// exact ingredient multiset a recipe demands — it stands a combo up with the deterministic
// devPlaceCombo (real stat block, exact once placed) and charges the mechanic's real cost by
// consuming (recipe.length−1) of the line's weakest feedstock towers as ingredients. So WHICH
// T5 ingredient was affordably reachable is abstracted; the combo's live DPS is the real sim's.
//
// Because the quality roll is random, each controller is a FACTORY (fresh closure state per
// match) and run.ts averages it over many seeds into a WIN RATE.

import {
  BUILDS_PER_LEVEL,
  COMBOS,
  MAX_REFINEMENT,
  MAX_TIER,
  affordableStamps,
  assembleCombo,
  buyRefinement,
  components,
  duplicatePair,
  keepComponent,
  layBlocker,
  mergeDuplicate,
  retarget,
  rollTier,
  rollType,
  upgradeCombos,
  weakestBaseComponents,
  type BuildCtx,
  type ComboType,
  type Component,
  type Controller,
  type Roll,
  type Tier,
} from "./harness";
import { clumpFor, firingFor, mazeFor, type Anchor } from "./mazes";
import type { Game } from "../src/sim";

// ---- Config-driven play ---------------------------------------------------------

// A strategy's independent knobs. `maze` picks the anchor field the level's rocks fill — the
// full-height serpentine COMB (a real maze), a tight central CLUMP (no fold), or NONE (only the
// kept guns, in a clump). `combine` gates the QUALITY-LADDER climb (merging duplicate base towers
// up a rung); `refine` gates UPGRADE QUALITY (biasing the roll). `combo` gates assembling
// COMBINATION TOWERS (the recipe merge — the redesign's headline power source): base towers are
// weak feedstock now, so whether a strategy assembles combos is a hard gate on the late game.
interface Play {
  name: string;
  note: string;
  maze: "comb" | "clump" | "none";
  combine: boolean;
  refine: boolean;
  combo: boolean;
}

// The harvest a build phase resolves (specs/build.md §4 — exactly one harvest a level):
// KEEP/COMBINE-two-rolls plants one NEW firing component, or MERGE combines two standing
// duplicates into one a rung higher (breadth-for-tier — the GemTD carry climb).
type Harvest = { kind: "new"; type: Component["type"]; tier: Tier } | { kind: "merge"; type: Component["type"]; tier: Tier };

// The tower COUNT a climbing player holds as its COVERAGE floor. A GemTD board is bimodal — a
// broad low/mid firing line lining the maze for coverage of the long route, plus a few
// high-tier CARRIES for raw kill-power on the scaled-up late Load. Below this the level KEEPs a
// NEW tower (widen coverage); at/above it, a level instead MERGEs two standing duplicates into
// a carry (climb the ladder), dropping back below the floor so the next keep refills it. So the
// line hovers at the floor while its dupes fold upward into Primed / Tesla-Prime carries.
const MERGE_FLOOR = 16;

// The combo ESCALATION plan (specs/towers.md — the 12 combination towers), ORDERED by the
// highest ingredient TIER a recipe demands (all-Scrap first, Tesla-gated apex last). A competent
// player assembles cheap early combos first, then climbs toward the apex four-ability masterworks
// as its feedstock reaches the higher rungs. The harness stands each one up with devPlaceCombo
// (its real, far-stronger stat block), consuming feedstock towers as ingredients — see
// assembleCombo. Indexed by how many combos already built (clamped), so the line escalates and
// then holds at the apex, which is exactly where a maxed player parks.
const COMBO_PLAN: ComboType[] = [
  "staticweb", // T1 recipe — early chain + slow crowd control
  "fusecluster", // T1 recipe — early splash + burn
  "slagdriver", // T2 recipe — early anti-tank crit
  "forkarray", // T3 recipe — swarm-shredder (multishot 3)
  "corroder", // T3 recipe — burn + slow + aura support
  "ionprism", // T4 recipe — burning splash that crits
  "nullcore", // T5 recipe — splash core + strong aura
  "rupturenode", // T5 recipe — heavy burning splash
  "reactorpile", // T5 recipe — twin-chain engine
  "blightcoil", // T5 recipe — chain + burn + slow denial
  "auroralance", // T5 recipe — apex reach + hard slow + chain
  "singularity", // T5 recipe — apex — splash + burn + crit + aura
];

// Combo cadence: a competent player lands its first combo around wave COMBO_START, then roughly
// one more every COMBO_EVERY waves — as soon as it can produce the recipe's ingredients AND has
// the feedstock towers to spend (else it keeps growing the line and retries next wave). Paced so
// combos accumulate to CARRY the scaled late waves without being free.
const COMBO_START = 6;
const COMBO_EVERY = 4;

// The highest base ingredient TIER a combo's recipe demands (specs/towers.md COMBOS) — the rung a
// strategy must be able to reach to assemble it.
function maxIngredientTier(combo: ComboType): number {
  return COMBOS[combo].recipe.reduce((m, ing) => Math.max(m, ing.tier), 1);
}

// The highest quality a stamp can ROLL at a given Refinement (specs/build.md QUALITY_ODDS_BY_R,
// GemTD's upgrade-chances tree): R0 rolls only Scrap, R1 up to Tuned, R2–3 up to Charged, R4–7
// up to Primed, and only the top rung R8 can roll Tesla-Prime — so the apex CAN be rolled, but
// only at max Refinement and only rarely; combining stays the reliable climb.
function rollCeiling(refinement: number): number {
  return refinement >= 8 ? 5 : refinement >= 4 ? 4 : refinement >= 2 ? 3 : refinement >= 1 ? 2 : 1;
}

// The highest base ingredient tier a strategy can plausibly have PRODUCED by `wave` — the model
// of "is this recipe reachable yet". It is what the press can ROLL (rollCeiling) plus, if the
// strategy CLIMBS the quality ladder (combine), extra rungs earned over time — and climbing is
// far faster with better feedstock, so the pace scales with (1 + refinement). Without refinement
// the press only ever yields Scrap, so a no-refine line climbs almost not at all (its combos stay
// the all-Scrap two); T4/T5 ingredients — which the press rolls only at high Refinement and only
// rarely — are mostly within reach of a refined climber deep into the run, which is why the apex
// combos gate the late game.
const CLIMB_SCALE = 75;
function reachableIngredientTier(canClimb: boolean, refinement: number, wave: number): number {
  const rc = rollCeiling(refinement);
  if (!canClimb) return rc;
  const climbRungs = Math.floor((wave * (1 + refinement)) / CLIMB_SCALE);
  return Math.min(MAX_TIER, rc + climbRungs);
}

// A roll's keep value: quality tier dominates, broken by TYPE usefulness — the rapid / area /
// chain / status types answer the early swarm, so a sane player keeps one of those over a slow
// single-target opener when the tiers tie (which steadies the luck-of-the-first-roll). All EIGHT
// base types must appear (Record<ComponentType>). The Regulator NEVER fires, so keeping it as a
// lone firing pick is worthless — it scores LOWEST, so a competent keep only ever lands on it
// when every roll this level is a Regulator (vanishingly rare); its real value is walled into the
// aura, not the firing line.
const TYPE_SCORE: Record<Component["type"], number> = {
  emitter: 7,
  arcnode: 6,
  coil: 5,
  rectifier: 4,
  choke: 3,
  capacitor: 2,
  discharge: 1,
  regulator: 0,
};
function keepScore(r: Roll): number {
  return r.tier * 10 + TYPE_SCORE[r.type];
}

// The best NEW tower this level can plant: the higher of {best single roll, best same-type+tier
// pair folded one rung up} — both cost the same single keep and both add exactly one tower.
function bestNew(rolls: Roll[]): { type: Component["type"]; tier: Tier } {
  const best = rolls.reduce((a, b) => (keepScore(b) > keepScore(a) ? b : a));
  let pair: Roll | null = null;
  for (let i = 0; i < rolls.length; i++) {
    for (let j = i + 1; j < rolls.length; j++) {
      const a = rolls[i]!;
      const b = rolls[j]!;
      if (a.type === b.type && a.tier === b.tier && a.tier < MAX_TIER && (!pair || a.tier > pair.tier)) pair = a;
    }
  }
  const tier = Math.max(best.tier, pair ? pair.tier + 1 : 0) as Tier;
  const type = pair && pair.tier + 1 >= best.tier ? pair.type : best.type;
  return { type, tier };
}

function decideHarvest(g: Game, rolls: Roll[], canCombine: boolean): Harvest {
  const nw = bestNew(rolls);
  if (!canCombine) {
    // A non-climber never combines — it only ever keeps its best single roll (no pair fold).
    const best = rolls.reduce((a, b) => (keepScore(b) > keepScore(a) ? b : a));
    return { kind: "new", type: best.type, tier: best.tier };
  }
  // Grow the coverage line first; once wide enough, spend the level MERGING two standing
  // duplicates into a carry (if any exist), else keep widening.
  if (components(g).length >= MERGE_FLOOR) {
    const dup = duplicatePair(g);
    if (dup) return { kind: "merge", type: dup.type, tier: dup.tier };
  }
  return { kind: "new", type: nw.type, tier: nw.tier };
}

interface Cursors {
  firing: number; // next FIRING anchor (kept towers, spread for coverage)
  blocker: number; // next BLOCKER anchor (maze walls, tooth-by-tooth)
  combosBuilt: number; // how many combination towers this strategy has assembled (COMBO_PLAN index)
  lastComboWave: number; // wave the last combo landed (drives the COMBO_EVERY cadence)
}

// One build phase of a config-driven strategy. Buys UPGRADE QUALITY (if enabled), rolls this
// level's free stamps off the real odds, resolves the single harvest (keep / combine),
// hardens the rest into blockers along its maze, and retargets. The
// kept tower lands on the FIRING anchors (spread mid-maze for coverage) and the un-kept rocks
// on the BLOCKER anchors (tooth-by-tooth walls) — two independent streams, so the firing line
// spreads while the maze walls rise where they choke the route.
function playBuild(cfg: Play, cur: Cursors, g: Game, ctx: BuildCtx): void {
  // Refinement first (competent only): climb R toward a wave-scaled target. Placing rocks is
  // free, so nothing needs to be held back for stamps.
  if (cfg.refine) buyRefinement(g, refineTarget(ctx.wave), 0);

  const n = affordableStamps(g);
  if (n <= 0) {
    retarget(g);
    return;
  }

  // Roll n rocks off the current Refinement odds (the modeled scrap-press).
  const rolls: Roll[] = [];
  for (let i = 0; i < n; i++) rolls.push({ type: rollType(ctx.rng), tier: rollTier(ctx.rng, g.refinement) });

  // A real maze fires from the tower-lined corridors of the comb and walls with its blockers;
  // the degenerate boards fire from a dense central clump — no-maze walls that clump into a
  // route-less blob, naive builds no wall at all.
  const firing = cfg.maze === "comb" ? firingFor(g.map.id) : clumpFor(g.map.id);
  const blockers = cfg.maze === "clump" ? clumpFor(g.map.id) : mazeFor(g.map.id);
  const nextFiring = (): Anchor => firing[cur.firing++ % firing.length]!;
  const nextBlocker = (): Anchor => blockers[cur.blocker++ % blockers.length]!;

  // The level's single harvest (specs/build.md §4). A combo-building strategy spends the level
  // ASSEMBLING a combination tower when the cadence is due and it has the feedstock to spend;
  // otherwise it resolves the ordinary keep / quality-combine.
  let didCombo = false;
  if (cfg.combo && ctx.wave >= COMBO_START && ctx.wave - cur.lastComboWave >= COMBO_EVERY) {
    const combo = COMBO_PLAN[Math.min(cur.combosBuilt, COMBO_PLAN.length - 1)]!;
    const reachable = reachableIngredientTier(cfg.combine, g.refinement, ctx.wave);
    const needIngredients = COMBOS[combo].recipe.length - 1; // the initiator is this level's own roll
    const feedstock = weakestBaseComponents(g, needIngredients);
    // Only assemble once (a) the strategy can PRODUCE the recipe's highest ingredient tier — a
    // no-refine line never rolls past Scrap, so its climb barely reaches T2/T3 and the apex
    // Tesla-gated recipes stay out of reach — and (b) the firing line has the ingredient towers to
    // fold in (a recipe consumes them, each hardening into a blocker). Else keep widening the line
    // and RETRY next wave (the cadence stays due until the rung is reachable).
    if (maxIngredientTier(combo) <= reachable && feedstock.length >= needIngredients && assembleCombo(g, combo, feedstock, nextFiring())) {
      cur.combosBuilt++;
      cur.lastComboWave = ctx.wave;
      didCombo = true;
    }
  }

  if (!didCombo) {
    // Resolve the ordinary keep / quality-combine (specs/build.md §4).
    const harvest = decideHarvest(g, rolls, cfg.combine);
    if (harvest.kind === "merge") {
      // Fold two standing duplicates into a carry a rung higher; no new firing footprint (the
      // consumed tower re-hardens into a blocker inside mergeDuplicate). Falls back to a keep if
      // the pair vanished.
      if (!mergeDuplicate(g, harvest.type, harvest.tier)) keepComponent(g, bestNew(rolls).type, bestNew(rolls).tier, nextFiring());
    } else {
      keepComponent(g, harvest.type, harvest.tier, nextFiring());
    }
  }

  // Every un-kept rock hardens into a blocker — the maze — EXCEPT the "no maze" plays, whose
  // leftover rocks still clump (no route fold). n rocks placed: 1 is the harvest focus.
  const blk = cfg.maze === "none" ? 0 : n - 1;
  for (let b = 0; b < blk; b++) layBlocker(g, nextBlocker());

  // Pump spare Charge into UPGRADING the standing combination towers (specs/towers.md) — combos
  // land weak at level 0, so a competent player climbs them with kill income (the gold sink).
  // Placing rocks is free, so all Charge is available for upgrades.
  if (cfg.combo) upgradeCombos(g, 0);

  retarget(g);
}

// Competent's UPGRADE QUALITY schedule: climb one Refinement rung roughly every ~4 waves,
// so late rolls bias to the high rungs (up to the R8 cap, where Tesla-Prime can roll) while
// early Charge still funds the maze. buyRefinement caps the actual purchase on affordability,
// so this is a ceiling, not a guarantee.
function refineTarget(wave: number): number {
  return Math.min(MAX_REFINEMENT, Math.floor(wave / 4) + 1);
}

function make(cfg: Play): () => Controller {
  return () => {
    const cur: Cursors = { firing: 0, blocker: 0, combosBuilt: 0, lastComboWave: COMBO_START - COMBO_EVERY };
    return {
      name: cfg.name,
      note: cfg.note,
      build(g, ctx) {
        playBuild(cfg, cur, g, ctx);
      },
    };
  };
}

// ---- The battery ----------------------------------------------------------------

// Each degenerate differs from `competent` by EXACTLY ONE lever, so a win-rate gap pins that
// lever's worth: `no-maze` = geometry off, `no-refine` = UPGRADE QUALITY off, `no-combo` = never
// assembles a combination tower (the redesign's headline gate — base towers alone are weak
// feedstock). `naive` is the floor (everything off).
const PLAYS: Play[] = [
  { name: "naive", note: "keep a roll, no maze, no combine, no refine, no combos (clump)", maze: "none", combine: false, refine: false, combo: false },
  { name: "no-maze", note: "climb + refine + build combos, but clump the guns (route never folds)", maze: "clump", combine: true, refine: true, combo: true },
  { name: "no-refine", note: "full maze + combine + combos, but never buy UPGRADE QUALITY", maze: "comb", combine: true, refine: false, combo: true },
  { name: "no-combo", note: "full maze + climb + refine, but NEVER assembles a combination tower", maze: "comb", combine: true, refine: true, combo: false },
  { name: "competent", note: "full maze + refine + climb + assembles combination towers + targeting", maze: "comb", combine: true, refine: true, combo: true },
];

export function controllerFactories(): Array<() => Controller> {
  return PLAYS.map(make);
}

export function controllerNames(): string[] {
  return PLAYS.map((p) => p.name);
}
