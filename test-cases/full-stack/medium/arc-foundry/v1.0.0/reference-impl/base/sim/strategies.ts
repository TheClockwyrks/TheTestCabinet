// Arc Foundry — the controller battery run.ts drives for the balance goal checks.
//
// Each controller plays a faithful GemTD loop through the harness model (specs/build.md):
// every build phase it may place up to BUILDS_PER_LEVEL rocks, KEEP EXACTLY ONE as a firing
// component (or COMBINE a match to climb a rung), and the rest harden into inert BLOCKERS —
// the maze. The single lever a good player pulls is GEOMETRY (fold the shortest open route
// into a long serpentine so the Load crawls past the guns) and the QUALITY LADDER (combine
// matches + buy UPGRADE QUALITY so a few carries reach the high, steep-damage rungs). The
// strategies isolate those two levers so the win rates pin what "balanced" means:
//
//   • naive       — keep a roll a level, but no maze and never climb (clump, no combine,     LOSE
//                    no refine): a route-less blob + Scrap guns. Leaks overwhelm.
//   • no-maze     — climb the ladder (combine + refine) but dump the walls into the guns,    LOSE
//                    so the route never folds. Isolates GEOMETRY: DPS with no coverage.
//   • no-refine   — full maze + combine, but never buy UPGRADE QUALITY, so its base rolls    LOSE
//                    stay Scrap and the combine climb is far too slow. The clear ladder loss.
//   • no-combine  — full maze + refine, but NEVER combine, so the line caps at CHARGED (the  ~soft
//                    roll alone never reaches Primed/Tesla-Prime). VIABLE but weaker — see the
//                    caveat below; combining is the EDGE, not a hard gate on these funnel maps.
//   • competent   — the reference good player: full maze, refine on a schedule, and MERGE     WIN
//                    duplicate towers into Tesla-Prime carries; targets the heavy rigs.
//
// Caveat surfaced by the balance pass (see sim/README.md): the maps funnel every unit across
// a central crossing, so a broad, well-mazed, refined firing line is the backbone and COMBINE
// is the winning edge (competent out-wins no-combine and is the ONLY line to reach the
// Tesla-Prime carries — Primed/Tesla-Prime are combine-only), not a strict requirement. So
// no-combine loses MORE than it wins to competent but is not crushed.
//
// Because the quality roll is random, each controller is a FACTORY (fresh closure state per
// match) and run.ts averages it over many seeds into a WIN RATE.

import {
  BUILDS_PER_LEVEL,
  MAX_TIER,
  affordableStamps,
  buyRefinement,
  components,
  debitStamps,
  duplicatePair,
  keepComponent,
  layBlocker,
  mergeDuplicate,
  retarget,
  rollTier,
  rollType,
  type BuildCtx,
  type Component,
  type Controller,
  type Roll,
  type Tier,
} from "./harness";
import { clumpFor, firingFor, mazeFor, type Anchor } from "./mazes";
import type { Game } from "../src/sim";

// ---- Config-driven play ---------------------------------------------------------

// A strategy's four independent knobs. `maze` picks the anchor field the level's rocks fill
// — the full-height serpentine COMB (a real maze), a tight central CLUMP (no fold), or NONE
// (only the kept guns, in a clump). `combine`/`refine` gate the two ladder mechanics.
interface Play {
  name: string;
  note: string;
  maze: "comb" | "clump" | "none";
  combine: boolean;
  refine: boolean;
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

// A roll's keep value: quality tier dominates, broken by TYPE usefulness — the rapid / area /
// chain types answer the early swarm, so a sane player keeps one of those over a slow
// single-target opener when the tiers tie (which steadies the luck-of-the-first-roll).
const TYPE_SCORE: Record<Component["type"], number> = { emitter: 4, arcnode: 3, coil: 2, capacitor: 1, discharge: 0 };
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
}

// One build phase of a config-driven strategy. Buys UPGRADE QUALITY (if enabled), rolls this
// level's affordable stamps off the real odds, resolves the single harvest (keep / combine),
// hardens the rest into blockers along its maze, debits the stamp spend, and retargets. The
// kept tower lands on the FIRING anchors (spread mid-maze for coverage) and the un-kept rocks
// on the BLOCKER anchors (tooth-by-tooth walls) — two independent streams, so the firing line
// spreads while the maze walls rise where they choke the route.
function playBuild(cfg: Play, cur: Cursors, g: Game, ctx: BuildCtx): void {
  // Refinement first (competent only): climb R toward a wave-scaled target, keeping enough
  // Charge back to still stamp a full allowance this level.
  if (cfg.refine) buyRefinement(g, refineTarget(ctx.wave), BUILDS_PER_LEVEL * 10);

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

  // Resolve the level's single keep/combine (specs/build.md §4).
  const harvest = decideHarvest(g, rolls, cfg.combine);
  if (harvest.kind === "merge") {
    // Fold two standing duplicates into a carry a rung higher; no new firing footprint (the
    // consumed tower re-hardens into a blocker inside mergeDuplicate). Falls back to a keep if
    // the pair vanished.
    if (!mergeDuplicate(g, harvest.type, harvest.tier)) keepComponent(g, bestNew(rolls).type, bestNew(rolls).tier, nextFiring());
  } else {
    keepComponent(g, harvest.type, harvest.tier, nextFiring());
  }

  // Every un-kept rock hardens into a blocker — the maze — EXCEPT the "no maze" plays, whose
  // leftover rocks still clump (no route fold). n rocks placed: 1 is the harvest focus.
  const blk = cfg.maze === "none" ? 0 : n - 1;
  for (let b = 0; b < blk; b++) layBlocker(g, nextBlocker());

  debitStamps(g, n);
  retarget(g);
}

// Competent's UPGRADE QUALITY schedule: climb one Refinement rung roughly every ~5 waves,
// so late rolls bias to the high rungs while early Charge still funds the maze. buyRefinement
// caps the actual purchase on affordability, so this is a ceiling, not a guarantee.
function refineTarget(wave: number): number {
  return Math.min(5, Math.floor(wave / 5) + 1);
}

function make(cfg: Play): () => Controller {
  return () => {
    const cur: Cursors = { firing: 0, blocker: 0 };
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

const PLAYS: Play[] = [
  { name: "naive", note: "keep a roll, no maze, no combine, no refine (clump)", maze: "none", combine: false, refine: false },
  { name: "no-maze", note: "climb the ladder, but clump the guns (route never folds)", maze: "clump", combine: true, refine: true },
  { name: "no-combine", note: "build the full maze + refine, but never climb the ladder", maze: "comb", combine: false, refine: true },
  { name: "no-refine", note: "full maze + combine, but never buy UPGRADE QUALITY", maze: "comb", combine: true, refine: false },
  { name: "competent", note: "full maze + keep/combine up the ladder + UPGRADE QUALITY + targeting", maze: "comb", combine: true, refine: true },
];

export function controllerFactories(): Array<() => Controller> {
  return PLAYS.map(make);
}

export function controllerNames(): string[] {
  return PLAYS.map((p) => p.name);
}
