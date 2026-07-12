// Valence — balance report runner.  npx tsx sim/run.ts [--detail=<name>] [--funded]
//
// Runs a battery of controllers (from energy-only spam to competent mixed play) and
// prints how far each survives, then checks the balance goals: energy-only spam,
// no-detection, never-upgraded, and one-lane boards must all LOSE, while a competent
// mixed + upgraded + well-placed board must WIN — under a realistic economy. Both branch
// leanings should also win (neither branch dominates).

import { MatchResult, runMatch } from "./harness";
import { controllerSet } from "./strategies";

function summarize(r: MatchResult): string {
  const res = r.outcome === "victory" ? "WIN " : "LOSS";
  const cleared = `${r.roundsCleared}/20`;
  return (
    `${res}  cleared ${cleared.padStart(5)}  integrity ${String(r.integrityLeft).padStart(3)}  ` +
    `score ${String(r.score).padStart(6)}  towers ${String(r.finalTowers).padStart(2)}  $${r.finalEnergy}`
  );
}

function detail(r: MatchResult): string {
  return r.rounds
    .map(
      (w) =>
        `  R${String(w.round).padStart(2)}  leak ${String(w.leaked).padStart(2)}  ` +
        `integ ${String(w.integrityAfter).padStart(3)}  $${String(w.energyAfter).padStart(4)}  ` +
        `towers ${String(w.towers).padStart(2)}  kills ${String(w.kills).padStart(3)}  ${w.resolved ? "" : "[UNRESOLVED]"}`,
    )
    .join("\n");
}

function main(): void {
  const detailArg = process.argv.find((a) => a.startsWith("--detail="))?.split("=")[1];
  const funded = process.argv.includes("--funded");
  if (funded) console.log("[funded mode: unlimited energy — isolates mechanics from economy]");

  const results: MatchResult[] = [];
  for (const c of controllerSet()) {
    const r = runMatch(c, { funded });
    results.push(r);
    console.log(`\n### ${c.name}${c.note ? `  — ${c.note}` : ""}`);
    console.log(`    ${summarize(r)}`);
    if (detailArg && (detailArg === c.name || detailArg === "all")) console.log(detail(r));
  }

  console.log("\n=== goal check ===");
  const by = (n: string) => results.find((r) => r.controller === n)!;
  const line = (label: string, r: MatchResult, wantWin: boolean) => {
    const ok = wantWin ? r.outcome === "victory" : r.outcome === "defeat";
    console.log(
      `  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(38)} ${r.outcome === "victory" ? "WIN" : "LOSS"} (cleared ${r.roundsCleared}, integrity ${r.integrityLeft})`,
    );
  };
  line("energy-only spam must lose", by("energy-spam"), false);
  line("no-detection must lose", by("no-detection"), false);
  line("never-upgraded must lose", by("no-upgrade"), false);
  line("one-lane cluster must lose", by("one-lane"), false);
  line("competent mixed must WIN", by("competent"), true);
  console.log("  --- soft: both branch leanings should win ---");
  line("A-branch competent should win", by("lean-A"), true);
  line("B-branch competent should win", by("lean-B"), true);
}

main();
