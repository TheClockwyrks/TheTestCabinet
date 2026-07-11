// Meltdown — balance report runner.  npx tsx sim/run.ts [--detail=<name>]
//
// Runs a battery of controllers (from no-maze to competent maze+heat play) and
// prints how far each survives, plus how "engaged" the heat system was (plateau
// occupancy and trip counts). Use it to check the two design goals: a no-maze
// defence should lose, a heat-ignorant one should struggle, and competent
// maze+heat play should win.

import { MatchResult, runMatch } from "./harness";
import { controllerSet } from "./strategies";

const controllers = controllerSet;

function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`;
}

function summarize(r: MatchResult): string {
  const res = r.outcome === "victory" ? "WIN " : "LOSS";
  const cleared = `${r.wavesCleared}/20`;
  return (
    `${res}  cleared ${cleared.padStart(5)}  lives ${String(r.livesLeft).padStart(2)}  ` +
    `score ${String(r.score).padStart(6)}  towers ${String(r.finalTowers).padStart(3)}  $${r.finalMoney}`
  );
}

function detail(r: MatchResult): string {
  const rows = r.waves.map((w) => {
    return (
      `  W${String(w.wave).padStart(2)}  ` +
      `leak ${String(w.leaked).padStart(2)}  lives ${String(w.livesAfter).padStart(2)}  ` +
      `$${String(w.moneyAfter).padStart(4)}  emit ${String(w.emitters).padStart(3)}  ` +
      `trips ${String(w.trips).padStart(3)}  hot ${pct(w.hotGunFrac).padStart(4)}  ` +
      `peak ${pct(w.peakHeat).padStart(4)}  meanH ${pct(w.heatFrac).padStart(4)}`
    );
  });
  return rows.join("\n");
}

function main(): void {
  const detailArg = process.argv.find((a) => a.startsWith("--detail="))?.split("=")[1];
  const funded = process.argv.includes("--funded");
  if (funded) console.log("[funded mode: unlimited money — isolates mechanics from economy]");

  const results: MatchResult[] = [];
  for (const c of controllers()) {
    const r = runMatch(c, { funded });
    results.push(r);
    console.log(`\n### ${c.name}${c.note ? `  — ${c.note}` : ""}`);
    console.log(`    ${summarize(r)}`);
    if (detailArg && (detailArg === c.name || detailArg === "all")) {
      console.log(detail(r));
    }
  }

  console.log("\n=== goal check ===");
  const flank = results.find((r) => r.controller === "flank-no-maze")!;
  const battery = results.find((r) => r.controller === "flank-battery")!;
  const ignored = results.find((r) => r.controller === "ace-ignored")!;
  const managed = results.find((r) => r.controller === "ace-managed")!;
  const line = (label: string, r: MatchResult, wantWin: boolean) => {
    const ok = wantWin ? r.outcome === "victory" : r.outcome === "gameover";
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(34)} ${r.outcome === "victory" ? "WIN" : "LOSS"} (cleared ${r.wavesCleared}, lives ${r.livesLeft})`);
  };
  line("no-maze flank must lose", flank, false);
  line("no-maze battery must lose", battery, false);
  line("maze but heat-ignored must lose", ignored, false);
  line("maze + heat must WIN", managed, true);
}

main();
