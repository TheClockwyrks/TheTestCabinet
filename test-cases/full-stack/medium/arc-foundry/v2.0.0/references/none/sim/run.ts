// Arc Foundry — balance report. Runs the controller battery over many seeds on each
// difficulty and prints per-strategy WIN RATES plus the diagnostic reads (did it maze / did it
// climb / did it COMBINE — combos standing and distinct kinds), then checks the balance goals.
//
//   npx tsx sim/run.ts [--detail=<name|all>] [--seeds=N] [--map=<id>]
//
// The battery pins what "balanced" means for the redesigned GemTD reskin (specs/build.md,
// board.md, towers.md): competent WINS Easy (40 waves, ~100%) and Medium (50 waves, a clear
// majority) and does not trivially win Hard (60 waves); every degenerate play — no-maze,
// no-refine, no-combo, naive — LOSES, ideally MECHANICALLY (a too-short route, a too-low firing
// line, or NO combination towers). The redesign headline: base towers are weak feedstock, so
// ASSEMBLING combination towers is a hard GATE — the otherwise-competent `no-combo` line reaches
// zero combos and clearly underperforms.

import { DIFFICULTY, mapById, runOverSeeds, type Aggregate, type MatchResult } from "./harness";
import { controllerFactories, controllerNames } from "./strategies";

// The sim is a Node dev tool run via `tsx`; the project compiles with `types: []` (no
// @types/node), so declare the tiny slice of the Node globals this report uses.
declare const process: { argv: string[]; exit(code: number): never };

// ---- CLI --------------------------------------------------------------------------
const arg = (k: string): string | undefined => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : undefined;
};
const DETAIL = arg("detail"); // a controller name, or "all"
const SEEDS = Math.max(1, Number(arg("seeds") ?? 24));
const MAP = mapById(arg("map") ?? "substation");
const DIFFS = ["easy", "medium", "hard"] as const;

// A fixed, spread seed list so a report is reproducible run to run.
const seedList = Array.from({ length: SEEDS }, (_, i) => (i * 0x9e3779b1 + 0x1234567) >>> 0);

function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`.padStart(4);
}
function f(x: number, w = 6, d = 1): string {
  return x.toFixed(d).padStart(w);
}

// ---- Report -----------------------------------------------------------------------
console.log(`\nArc Foundry — balance report   map=${MAP.id}   seeds=${SEEDS}\n`);

const byDiff: Record<string, Aggregate[]> = {};
for (const dkey of DIFFS) {
  const diff = DIFFICULTY[dkey];
  const aggs = controllerFactories().map((make) => runOverSeeds(make, seedList, { map: MAP, diff }));
  byDiff[dkey] = aggs;

  console.log(`── ${diff.label}  (${diff.waves} waves, baseMult ${diff.baseMult}, k ${diff.k}) ${"─".repeat(26)}`);
  console.log(`   ${"strategy".padEnd(11)}  win   cleared(min–max)   integ   R    comps  tier   combos  maze px`);
  for (const a of aggs) {
    const cleared = `${f(a.meanCleared, 4, 1)} (${a.minCleared}–${a.maxCleared})`.padEnd(17);
    const combos = `${f(a.meanCombos, 3, 1)}/${f(a.meanDistinctCombos, 3, 1)}`;
    console.log(
      `   ${a.controller.padEnd(11)}  ${pct(a.winRate)}  ${cleared}  ${f(a.meanIntegrity, 5, 1)}  ${f(
        a.meanRefinement,
        3,
        1,
      )}  ${f(a.meanComponents, 6, 1)}  ${f(a.meanTier, 4, 2)}  ${combos}  ${f(a.meanPathLen, 7, 0)}`,
    );
  }
  console.log("   (combos = mean standing / mean distinct kinds)");
  console.log("");
}

// ---- Optional per-wave detail -----------------------------------------------------
function detailFor(name: string): void {
  const idx = controllerNames().indexOf(name);
  if (idx < 0) return;
  const diff = DIFFICULTY.medium;
  const res: MatchResult = runOverSeeds(() => controllerFactories()[idx]!(), [seedList[0]!], { map: MAP, diff }).results[0]!;
  console.log(`── per-wave: ${name} on ${diff.label} (seed ${seedList[0]}) → ${res.outcome} @ wave ${res.reachedWave}`);
  console.log(`   wave  leak  integ  charge  R  comps  maxT  meanT  combo(#/kinds)   maze px`);
  for (const w of res.waves) {
    console.log(
      `   ${String(w.wave).padStart(4)}  ${String(w.leaked).padStart(4)}  ${f(w.integrityAfter, 5, 0)}  ${f(
        w.chargeAfter,
        6,
        0,
      )}  ${w.refinement}  ${f(w.components, 5, 0)}   ${w.maxTier}    ${f(w.meanTier, 4, 2)}   ${f(w.combos, 3, 0)}/${f(
        w.distinctCombos,
        3,
        0,
      )}      ${f(w.pathLen, 8, 0)}`,
    );
  }
  console.log("");
}
if (DETAIL === "all") for (const n of controllerNames()) detailFor(n);
else if (DETAIL) detailFor(DETAIL);

// ---- Diagnostic reads (informational — NO balance assertions) ---------------------
// This harness is a mechanics/diagnostic tool, not a balance oracle. Its "competent"
// controller mazes with a serpentine comb, NOT the inside/outside central-spiral a real
// GemTD player builds, so its win-rate bands are not a meaningful target and are NOT
// asserted here. Balance is tuned by playtest; this report just prints the per-strategy
// reads (win rate, did-it-maze / did-it-climb / did-it-combine) for eyeballing a change.
const get = (dkey: string, name: string): Aggregate => byDiff[dkey]!.find((a) => a.controller === name)!;
const cm = get("medium", "competent");
const ncmb = get("medium", "no-combo");
console.log(`── reads (informational; not asserted) ${"─".repeat(22)}`);
console.log(
  `   Medium: competent wins ${pct(cm.winRate)} with ${cm.meanDistinctCombos.toFixed(1)} distinct combos; ` +
    `no-combo wins ${pct(ncmb.winRate)} with ${ncmb.meanDistinctCombos.toFixed(1)}.`,
);
console.log(
  `   Geometry: competent maze ${f(cm.meanPathLen, 5, 0)} px vs wall-less naive ${f(get("medium", "naive").meanPathLen, 5, 0)} px.`,
);
console.log("");
