// Arc Foundry — balance report runner.
//   npx tsx sim/run.ts [--detail=<name>] [--funded] [--seeds=N] [--map=<id>]
//
// Arc Foundry is a GemTD reskin: the scrap-press roll is RANDOM, so a single seed is
// not representative. This runner plays the whole controller battery over MANY seeds
// per difficulty and reports each controller's WIN RATE (plus waves-cleared and
// integrity/tier stats), then a PASS/FAIL goal-check block on the reference difficulty
// (medium). --funded swaps the random press for exact devPlace tiers to check that the
// battery separates for MECHANICAL reasons (geometry + the quality ladder), not just
// the economy.

import {
  DIFFICULTY,
  mapById,
  runOverSeeds,
  type Aggregate,
  type DifficultyDef,
  type MapDef,
  type MatchResult,
} from "./harness";
import { controllerSet } from "./strategies";

const argOf = (k: string): string | undefined => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];

const DETAIL = argOf("detail");
const FUNDED = process.argv.includes("--funded");
const MAP: MapDef = mapById(argOf("map") ?? "substation");
const SEEDS = Math.max(1, Number(argOf("seeds") ?? (FUNDED ? 4 : 16)));
// A fixed, spread seed list so a report is reproducible run to run.
const seedList = Array.from({ length: SEEDS }, (_, i) => (0x1000 + i * 0x9e37) >>> 0);

const DIFFS: DifficultyDef[] = [DIFFICULTY.easy, DIFFICULTY.medium, DIFFICULTY.hard];

function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`;
}

function aggLine(a: Aggregate, waves: number): string {
  return (
    `  ${a.controller.padEnd(15)} ` +
    `win ${pct(a.winRate).padStart(4)} (${String(a.wins).padStart(2)}/${a.seeds})  ` +
    `cleared ${a.meanCleared.toFixed(1).padStart(4)}/${waves} [${a.minCleared}..${a.maxCleared}]  ` +
    `integ ${a.meanIntegrity.toFixed(1).padStart(4)}  ` +
    `tier ${a.meanTier.toFixed(2)}  ` +
    `maze ${Math.round(a.meanPathLen).toString().padStart(4)}px  ` +
    `score ${Math.round(a.meanScore).toString().padStart(6)}`
  );
}

function detailMatch(r: MatchResult): string {
  const head = `  [detail: ${r.controller}  map=${r.map}  diff=${r.difficulty}  seed=${r.seed}  → ${r.outcome.toUpperCase()} cleared ${r.wavesCleared}/${DIFFICULTY[r.difficulty as keyof typeof DIFFICULTY].waves}]`;
  const rows = r.waves.map(
    (w) =>
      `    W${String(w.wave).padStart(2)}  leak ${String(w.leaked).padStart(2)}  ` +
      `integ ${String(w.integrityAfter).padStart(3)}  $${String(w.chargeAfter).padStart(4)}  ` +
      `comps ${String(w.components).padStart(3)}  Tmean ${w.meanTier.toFixed(2)} Tmax ${w.maxTier}  ` +
      `maze ${String(Math.round(w.pathLen)).padStart(4)}px  ` +
      `kills ${String(w.kills).padStart(3)}  ${w.resolved ? "" : "[UNRESOLVED]"}`,
  );
  return [head, ...rows].join("\n");
}

function main(): void {
  console.log(`Arc Foundry balance sim — map=${MAP.name} (${MAP.id})  seeds=${SEEDS}${FUNDED ? "  [FUNDED: unlimited Charge + exact tiers via devPlace — isolates mechanics]" : "  [realistic: random scrap-press over seeds]"}`);

  const byDiff = new Map<string, Aggregate[]>();
  for (const diff of DIFFS) {
    console.log(`\n=== ${diff.label}  (${diff.waves} waves, baseMult ${diff.baseMult}, k ${diff.k}) ===`);
    const aggs: Aggregate[] = [];
    for (const c of controllerSet()) {
      // controllerSet() is called once per difficulty; runOverSeeds re-makes a fresh
      // controller per seed by index into the freshly-built set.
      const idx = controllerSet().findIndex((x) => x.name === c.name);
      const agg = runOverSeeds(() => controllerSet()[idx]!, seedList, { map: MAP, diff, funded: FUNDED });
      aggs.push(agg);
      console.log(aggLine(agg, diff.waves));
      if (DETAIL && (DETAIL === c.name || DETAIL === "all")) {
        console.log(detailMatch(agg.results[0]!));
      }
    }
    byDiff.set(diff.key, aggs);
  }

  // ---- Goal check on the reference difficulty (medium) --------------------------
  console.log("\n=== goal check (medium — the reference balance) ===");
  const med = byDiff.get("medium")!;
  const by = (n: string) => med.find((a) => a.controller === n)!;
  const WIN = 0.6; // a controller "wins" the difficulty if it clears ≥60% of seeds
  const LOSE = 0.25; // and "loses" if it clears ≤25%
  const line = (label: string, a: Aggregate, wantWin: boolean) => {
    const ok = wantWin ? a.winRate >= WIN : a.winRate <= LOSE;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(40)} win ${pct(a.winRate)} (${a.wins}/${a.seeds}), mean cleared ${a.meanCleared.toFixed(1)}, integ ${a.meanIntegrity.toFixed(1)}`);
  };
  line("naive must lose", by("naive"), false);
  line("no-combine must lose", by("no-combine"), false);
  line("no-maze must lose/struggle", by("no-maze"), false);
  line("competent must WIN", by("competent"), true);

  console.log("  --- soft: no single component type carries (leans ≤ competent) ---");
  const comp = by("competent");
  for (const lean of ["lean-arcnode", "lean-discharge"]) {
    const a = by(lean);
    const ok = a.winRate <= comp.winRate + 1e-9;
    console.log(`  ${ok ? "ok  " : "hmm "}  ${lean.padEnd(40)} win ${pct(a.winRate)} vs competent ${pct(comp.winRate)}`);
  }

  // A compact cross-difficulty read for competent (should scale: easy≥medium≥hard).
  console.log("\n=== competent across difficulty ===");
  for (const diff of DIFFS) {
    const a = byDiff.get(diff.key)!.find((x) => x.controller === "competent")!;
    console.log(`  ${diff.label.padEnd(7)} win ${pct(a.winRate).padStart(4)} (${a.wins}/${a.seeds})  mean cleared ${a.meanCleared.toFixed(1)}/${diff.waves}  integ ${a.meanIntegrity.toFixed(1)}`);
  }
}

main();
