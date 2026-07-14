// Arc Foundry — balance report. Runs the controller battery over many seeds on each
// difficulty and prints per-strategy WIN RATES plus the two diagnostic reads (did it maze /
// did it climb), then checks the balance goals.
//
//   npx tsx sim/run.ts [--detail=<name|all>] [--seeds=N] [--map=<id>]
//
// The battery pins what "balanced" means for the GemTD reskin (specs/build.md, board.md,
// towers.md): competent WINS Easy (~100%) and Medium (a clear majority), and every
// degenerate play — no maze, no combine, no refine, naive — LOSES, and ideally loses
// MECHANICALLY (a too-short route or a too-low firing line, not just a starved economy).

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
  console.log(`   ${"strategy".padEnd(11)}  win   cleared(min–max)   integ   R    comps  tier    maze px`);
  for (const a of aggs) {
    const cleared = `${f(a.meanCleared, 4, 1)} (${a.minCleared}–${a.maxCleared})`.padEnd(17);
    console.log(
      `   ${a.controller.padEnd(11)}  ${pct(a.winRate)}  ${cleared}  ${f(a.meanIntegrity, 5, 1)}  ${f(
        a.meanRefinement,
        3,
        1,
      )}  ${f(a.meanComponents, 6, 1)}  ${f(a.meanTier, 4, 2)}  ${f(a.meanPathLen, 7, 0)}`,
    );
  }
  console.log("");
}

// ---- Optional per-wave detail -----------------------------------------------------
function detailFor(name: string): void {
  const idx = controllerNames().indexOf(name);
  if (idx < 0) return;
  const diff = DIFFICULTY.medium;
  const res: MatchResult = runOverSeeds(() => controllerFactories()[idx]!(), [seedList[0]!], { map: MAP, diff }).results[0]!;
  console.log(`── per-wave: ${name} on ${diff.label} (seed ${seedList[0]}) → ${res.outcome} @ wave ${res.reachedWave}`);
  console.log(`   wave  leak  integ  charge  R  comps  maxT  meanT   maze px`);
  for (const w of res.waves) {
    console.log(
      `   ${String(w.wave).padStart(4)}  ${String(w.leaked).padStart(4)}  ${f(w.integrityAfter, 5, 0)}  ${f(
        w.chargeAfter,
        6,
        0,
      )}  ${w.refinement}  ${f(w.components, 5, 0)}   ${w.maxTier}    ${f(w.meanTier, 4, 2)}  ${f(w.pathLen, 8, 0)}`,
    );
  }
  console.log("");
}
if (DETAIL === "all") for (const n of controllerNames()) detailFor(n);
else if (DETAIL) detailFor(DETAIL);

// ---- Goal checks ------------------------------------------------------------------
const get = (dkey: string, name: string): Aggregate => byDiff[dkey]!.find((a) => a.controller === name)!;
const meanMaxTier = (a: Aggregate): number => a.results.reduce((s, r) => s + r.maxTier, 0) / (a.results.length || 1);
const checks: Array<{ label: string; ok: boolean; detail: string }> = [];
const add = (label: string, ok: boolean, detail: string) => checks.push({ label, ok, detail });

// The reference "good player" clears the tuned campaign; the shorter Easy siege it wins
// outright, and it never trivially clears the brutal Hard HP climb.
add("competent wins Easy ≈100%", get("easy", "competent").winRate >= 0.95, pct(get("easy", "competent").winRate));
add("competent wins Medium (majority ≥80%)", get("medium", "competent").winRate >= 0.8, pct(get("medium", "competent").winRate));
add("competent does not trivially win Hard", get("hard", "competent").winRate <= 0.6, pct(get("hard", "competent").winRate));

// The board-breaking degenerates lose clearly and MECHANICALLY: no-maze / naive dump their
// walls into the kill zone (route never folds), and no-refine never buys UPGRADE QUALITY so
// its firing line stays low and its combine climb is too slow.
add("no-maze loses Medium (route never folds)", get("medium", "no-maze").winRate <= 0.15, pct(get("medium", "no-maze").winRate));
add("naive loses Medium (no maze, no ladder)", get("medium", "naive").winRate <= 0.15, pct(get("medium", "naive").winRate));
add("no-refine loses Medium (no UPGRADE QUALITY)", get("medium", "no-refine").winRate <= 0.15, pct(get("medium", "no-refine").winRate));

// The two levers separate the field. GEOMETRY: competent's tower-lined comb folds the route
// well past a route-less clump. THE LADDER: only a COMBINER reaches the Primed / Tesla-Prime
// carries — the roll alone (no-combine, however wide + refined) caps at Charged — so competent
// out-wins no-combine by a clear margin and reaches a strictly higher quality ceiling.
add(
  "competent mazes longer than a clump (geometry)",
  get("medium", "competent").meanPathLen > 1.25 * get("medium", "no-maze").meanPathLen,
  `${f(get("medium", "competent").meanPathLen, 5, 0)} vs ${f(get("medium", "no-maze").meanPathLen, 5, 0)} px`,
);
add(
  "only combining reaches Tesla-Prime carries",
  meanMaxTier(get("medium", "competent")) >= 4.5 && meanMaxTier(get("medium", "no-combine")) <= 3.2,
  `competent maxT ${f(meanMaxTier(get("medium", "competent")), 4, 1)} vs no-combine maxT ${f(meanMaxTier(get("medium", "no-combine")), 4, 1)}`,
);
add(
  "combining is the edge (competent out-wins no-combine)",
  get("medium", "competent").winRate - get("medium", "no-combine").winRate >= 0.1,
  `${pct(get("medium", "competent").winRate)} vs ${pct(get("medium", "no-combine").winRate)}`,
);

console.log(`── goal checks ${"─".repeat(46)}`);
let allOk = true;
for (const c of checks) {
  allOk = allOk && c.ok;
  console.log(`   ${c.ok ? "PASS" : "FAIL"}  ${c.label.padEnd(44)}  ${c.detail}`);
}
console.log(`\n${allOk ? "ALL GOAL CHECKS PASS" : "SOME GOAL CHECKS FAILED"}`);

// A standing caveat the balance pass surfaced (see sim/README.md): a NO-COMBINE line that
// still mazes + refines remains viable on these funnel maps — combining is the decisive EDGE
// (competent wins more and is the only line to reach the Tesla-Prime carries), not a hard
// requirement. Flagged, not hidden.
const nc = get("medium", "no-combine").winRate;
if (nc > 0.15) console.log(`NOTE: no-combine still wins ${pct(nc)} of Medium — combining is the edge, not a hard gate (see sim/README.md).`);
console.log("");
process.exit(allOk ? 0 : 1);
