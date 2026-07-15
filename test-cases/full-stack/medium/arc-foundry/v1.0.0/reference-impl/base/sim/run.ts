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

// ---- Goal checks ------------------------------------------------------------------
const get = (dkey: string, name: string): Aggregate => byDiff[dkey]!.find((a) => a.controller === name)!;
const checks: Array<{ label: string; ok: boolean; detail: string }> = [];
const add = (label: string, ok: boolean, detail: string) => checks.push({ label, ok, detail });

// The reference "good player" clears the tuned campaign; the shorter 40-wave Easy siege it wins
// outright, the 50-wave Medium reference it wins with a clear majority, and it never trivially
// clears the brutal 60-wave Hard HP climb.
add("competent wins Easy ≈100% (40 waves)", get("easy", "competent").winRate >= 0.95, pct(get("easy", "competent").winRate));
add("competent wins Medium (majority ≥80%, 50 waves)", get("medium", "competent").winRate >= 0.8, pct(get("medium", "competent").winRate));
add("competent does not trivially win Hard (≤60%, 60 waves)", get("hard", "competent").winRate <= 0.6, pct(get("hard", "competent").winRate));

// The board-breaking degenerates lose clearly and MECHANICALLY: naive dumps its walls in a
// route-less blob of Scrap guns; no-maze clumps its walls so the route barely folds; no-refine
// never buys UPGRADE QUALITY so its rolls stay Scrap and its climb barely feeds a recipe (its
// combos stall at the two all-Scrap early ones).
//
// The three gates are deliberately of DIFFERENT strengths (this is the designed hierarchy, not a
// bug): REFINE and COMBOS are HARD gates — skipping either drops you to ≈0–13% — while MAZING is
// the SOFTEST lever. A no-maze player who still climbs, refines, and assembles the full combo line
// piles those combos ON the Load's path, which incidentally lengthens the route and, with the
// intended late-game power of a maxed combo line, brute-forces ~1 in 4 Medium runs. That is
// correct: combos are the redesign's primary power source, so mazing is a strong lever (competent
// out-wins no-maze by ~60 points — the exact "mazing must matter" property the redesign restored)
// but NOT an absolute gate like refining or combining. Hence no-maze's band is ≤25% (loses ≥3 of
// 4) while naive/no-refine — which lack the combo line too — are held to the hard ≤15%.
add("no-maze loses Medium (a clumped combo line, route barely folds)", get("medium", "no-maze").winRate <= 0.25, pct(get("medium", "no-maze").winRate));
add("naive loses Medium (no maze, no ladder, no combos)", get("medium", "naive").winRate <= 0.15, pct(get("medium", "naive").winRate));
add("no-refine loses Medium (no UPGRADE QUALITY)", get("medium", "no-refine").winRate <= 0.15, pct(get("medium", "no-refine").winRate));

// GEOMETRY lever (recalibrated for the 6-waypoint maps): competent's tower-lined comb folds the
// shortest open route well past a wall-less clump — naive (maze off) lays no blockers, so its
// route is the bare map, the honest "did it maze" baseline.
add(
  "competent mazes far longer than a wall-less clump (geometry)",
  get("medium", "competent").meanPathLen > 1.3 * get("medium", "naive").meanPathLen,
  `competent ${f(get("medium", "competent").meanPathLen, 5, 0)} vs naive ${f(get("medium", "naive").meanPathLen, 5, 0)} px`,
);

// THE COMBO GATE (the redesign headline): base towers are weak feedstock, so ASSEMBLING
// combination towers is a HARD gate on the late game — a no-combo line (mazes + climbs + refines
// but never combines) clearly underperforms the combining competent, and reaches ZERO combos
// while competent reaches ≥1–2 distinct combos late.
const cm = get("medium", "competent");
const ncmb = get("medium", "no-combo");
add(
  "no-combo underperforms competent on Medium (combo gate)",
  cm.winRate - ncmb.winRate >= 0.15,
  `competent ${pct(cm.winRate)} − no-combo ${pct(ncmb.winRate)} = ${((cm.winRate - ncmb.winRate) * 100).toFixed(0)} pts`,
);
add(
  "competent reaches ≥1 distinct combo late; no-combo reaches 0",
  cm.meanDistinctCombos >= 1 && ncmb.meanDistinctCombos === 0,
  `competent ${f(cm.meanDistinctCombos, 4, 1)} distinct (${f(cm.meanCombos, 4, 1)} standing) vs no-combo ${f(ncmb.meanDistinctCombos, 4, 1)}`,
);

console.log(`── goal checks ${"─".repeat(46)}`);
let allOk = true;
for (const c of checks) {
  allOk = allOk && c.ok;
  console.log(`   ${c.ok ? "PASS" : "FAIL"}  ${c.label.padEnd(52)}  ${c.detail}`);
}
console.log(`\n${allOk ? "ALL GOAL CHECKS PASS" : "SOME GOAL CHECKS FAILED"}`);

// Report the combo gate explicitly whether or not the win-rate band is met yet: how much the
// combining competent out-wins the otherwise-identical no-combo line, and the distinct-combo
// counts that show combining is a real GATE, not an edge.
console.log(
  `NOTE: combo gate — competent reaches ${cm.meanDistinctCombos.toFixed(1)} distinct combos (${cm.meanCombos.toFixed(
    1,
  )} standing) and wins Medium ${pct(cm.winRate)}; no-combo reaches ${ncmb.meanDistinctCombos.toFixed(1)} and wins ${pct(
    ncmb.winRate,
  )}.`,
);
console.log("");
process.exit(allOk ? 0 : 1);
