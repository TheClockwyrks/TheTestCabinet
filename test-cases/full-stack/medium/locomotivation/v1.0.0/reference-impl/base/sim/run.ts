// Locomotivation — balance report.
//
// Drives the SCRIPTED competent route (sim/routes.ts) over the six-level campaign against the
// pure core (../src/sim) at the fixed timestep, as fast as possible — no rendering, no wall
// clock. It reports, per level: completed?, time used vs the clock, the beatability MARGIN (the
// shift clock still on the board the moment the quota was satisfied), deaths / lives used, unique
// package deliveries, quota met, and score. It then pins the balance goals (specs/levels.md):
//
//   • BEATABLE — the competent route clears every level within its clock and 3 lives, with a
//     sensible margin (never a frame-perfect fluke).
//   • RAMP — L1 is comfortable (a large margin), the middle levels are tighter, and L5/L6 are
//     clearly hard (a small margin); some levels are clearly harder than others.
//   • PRESSURE — a `reckless` route (ignores the schedules) and a `greedy` route (overloads past
//     the sprint threshold) both do clearly worse: the timing and the carry weight actually bite.
//
// The harness asserts every goal and exits non-zero on any failure.
//
//   npx tsx sim/run.ts [--detail]

import { fingerprint, LEVELS, runLevel, type MatchResult } from "./harness";
import { CONTROLLERS } from "./strategies";
import { buildWorld, noInput, tileCenter, type SimInput } from "../src/sim/world";
import { stepSim } from "../src/sim/step";
import { DT } from "../src/constants";

declare const process: { argv: string[]; exit(code: number): never };
const DETAIL = process.argv.includes("--detail");

function pad(s: string | number, n: number): string {
  return String(s).padEnd(n);
}
function padL(s: string | number, n: number): string {
  return String(s).padStart(n);
}
function f(x: number, d = 1): string {
  return x.toFixed(d);
}

// ─── Determinism + lever mechanic ────────────────────────────────────────────────────────

function makeTape(seed: number, n: number): SimInput[] {
  let x = seed >>> 0;
  const rnd = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const tape: SimInput[] = [];
  for (let i = 0; i < n; i++) {
    tape.push({
      up: rnd() > 0.6,
      down: rnd() > 0.6,
      left: rnd() > 0.6,
      right: rnd() > 0.6,
      sprint: rnd() > 0.7,
      pickup: rnd() > 0.95,
      drop: rnd() > 0.98,
      interact: rnd() > 0.97,
    });
  }
  return tape;
}

console.log("\nLocomotivation — balance report\n");

let determinismOk = true;
for (let i = 0; i < LEVELS.length; i++) {
  const tape = makeTape(9001 + i, 4000);
  const a = fingerprint(LEVELS[i], tape);
  const b = fingerprint(LEVELS[i], tape);
  const short = makeTape(9001 + i, 90);
  const s1 = fingerprint(LEVELS[i], short);
  const s2 = fingerprint(LEVELS[i], [...short, noInput()]);
  if (!(a === b && s1 !== s2)) determinismOk = false;
}
console.log(`  determinism (6 levels): ${determinismOk ? "ALL OK" : "FAILED"}`);

// The junction-switch mechanic is deterministic: standing by a lever and pressing interact flips
// which line the NEXT train on that track takes. Exercised on the first level that has a lever.
function leverCheck(): boolean {
  const lvl = LEVELS.find((l) => l.levers.length > 0);
  if (!lvl) return true;
  const lever = lvl.levers[0];
  const track = lvl.tracks.find((t) => t.id === lever.trackId);
  if (!track || track.sidingLine === undefined) return false;
  const s = buildWorld(lvl);
  s.worker.pos = { ...tileCenter(lever.at) }; // stand on the lever
  const hold: SimInput = { ...noInput(), interact: true };
  stepSim(s, hold, DT); // one interact pulse toggles the lever
  const thrown = s.levers[lever.id]?.thrown === true;
  // Advance until a fresh train spawns on that track, and confirm it took the siding line.
  let sawSiding = false;
  for (let i = 0; i < 60 * 30 && !sawSiding; i++) {
    stepSim(s, noInput(), DT);
    for (const t of s.trains) if (t.trackId === track.id && t.line === track.sidingLine) sawSiding = true;
  }
  return thrown && sawSiding;
}
const leverOk = leverCheck();
console.log(`  lever mechanic: ${leverOk ? "OK (diverts subsequent trains to the siding)" : "FAILED"}\n`);

// ─── Run every controller over the campaign ────────────────────────────────────────────────

const byController: Record<string, MatchResult[]> = {};
for (const c of CONTROLLERS) {
  byController[c.name] = LEVELS.map((lvl) => runLevel(lvl, c.make(lvl.id)));
}
const competent = byController["competent"];
const reckless = byController["reckless"];
const greedy = byController["greedy"];

function table(name: string, results: MatchResult[]): void {
  console.log(`── ${name} ${"─".repeat(70 - name.length)}`);
  console.log(
    `  ${pad("LEVEL", 20)} ${pad("RESULT", 8)} ${padL("MARGIN", 9)} ${padL("USED", 9)} ${padL("LIVES", 6)} ${padL("UNIQ", 6)} ${padL("QUOTA", 6)} ${padL("SCORE", 8)}`,
  );
  for (const r of results) {
    const margin = Number.isNaN(r.clockAtQuota) ? "—" : `${f(r.clockAtQuota)}s`;
    const used = `${f(r.clockTotal - r.clockAtQuota)}s`;
    const usedShown = Number.isNaN(r.clockAtQuota) ? "—" : used;
    const res = r.outcome === "won" ? "WON" : r.outcome === "lost" ? `LOST` : "TIMEOUT";
    const note = r.outcome !== "won" ? ` ${r.failReason ?? ""}` : "";
    console.log(
      `  ${pad(`${r.levelId}. ${r.levelName}`, 20)} ${pad(res, 8)} ${padL(margin, 9)} ${padL(usedShown, 9)} ${padL(
        `${r.livesUsed}/3`,
        6,
      )} ${padL(`${r.uniquesDelivered}/${r.uniquesTotal}`, 6)} ${padL(r.quotaMet ? "yes" : "no", 6)} ${padL(r.score, 8)}${note}`,
    );
  }
  const wins = results.filter((r) => r.outcome === "won").length;
  const total = results.reduce((s, r) => s + r.score, 0);
  console.log(`  → ${wins}/${results.length} levels cleared, total score ${total}\n`);
}

table("COMPETENT (scripted schedule-reading route)", competent);
if (DETAIL) {
  table("RECKLESS (same route, ignores the schedules)", reckless);
  table("GREEDY (gates, but overloads past the sprint threshold)", greedy);
} else {
  const line = (name: string, rs: MatchResult[]) =>
    console.log(
      `  ${pad(name, 10)} cleared ${rs.filter((r) => r.outcome === "won").length}/6, total score ${rs.reduce(
        (s, r) => s + r.score,
        0,
      )}, deaths ${rs.reduce((s, r) => s + r.livesUsed, 0)}`,
    );
  console.log("── degenerate baselines " + "─".repeat(50));
  line("reckless", reckless);
  line("greedy", greedy);
  console.log("  (run with --detail for the full per-level breakdown)\n");
}

// ─── Goal checks ──────────────────────────────────────────────────────────────────────────

const checks: Array<{ label: string; ok: boolean; detail: string }> = [];
const add = (label: string, ok: boolean, detail: string) => checks.push({ label, ok, detail });

const margin = (i: number) => competent[i].clockAtQuota;
const compWins = competent.filter((r) => r.outcome === "won").length;
const compScore = competent.reduce((s, r) => s + r.score, 0);
const recklessWins = reckless.filter((r) => r.outcome === "won").length;
const recklessScore = reckless.reduce((s, r) => s + r.score, 0);
const greedyWins = greedy.filter((r) => r.outcome === "won").length;
const greedyScore = greedy.reduce((s, r) => s + r.score, 0);

// Determinism + mechanic.
add("core is deterministic (all 6 levels)", determinismOk, determinismOk ? "OK" : "FAILED");
add("junction lever diverts subsequent trains", leverOk, leverOk ? "OK" : "FAILED");

// BEATABLE — every level cleared, no unique lost, within a sane life budget and a real margin.
add("competent clears all 6 levels", compWins === 6, `${compWins}/6`);
for (const r of competent) {
  add(
    `L${r.levelId} beatable with margin (won, ≥3s spare, ≤2 lives, uniques safe)`,
    r.outcome === "won" && r.clockAtQuota >= 3 && r.livesUsed <= 2 && r.uniquesDelivered === r.uniquesTotal,
    `${r.outcome}, margin ${Number.isNaN(r.clockAtQuota) ? "—" : f(r.clockAtQuota) + "s"}, ${r.livesUsed} deaths, uniques ${r.uniquesDelivered}/${r.uniquesTotal}`,
  );
}

// RAMP — L1 comfortable; L5/L6 clearly hard; the spread is real.
add("L1 is comfortable (margin ≥ 30s)", margin(0) >= 30, `${f(margin(0))}s`);
add("L1 is clearly the roomiest (> every later level by ≥ 8s)", competent.slice(1).every((r) => margin(0) - r.clockAtQuota >= 8), `L1 ${f(margin(0))}s vs max later ${f(Math.max(...competent.slice(1).map((r) => r.clockAtQuota)))}s`);
add("middle levels are tighter than L1 (L3,L4 margin ≤ 22s)", margin(2) <= 22 && margin(3) <= 22, `L3 ${f(margin(2))}s, L4 ${f(margin(3))}s`);
add("L5 & L6 are the hard shifts (margin ≤ 14s but > 3s)", margin(4) <= 14 && margin(4) > 3 && margin(5) <= 14 && margin(5) > 3, `L5 ${f(margin(4))}s, L6 ${f(margin(5))}s`);
add("L6 (finale) is at least as tight as the earliest crossing level (≤ L3)", margin(5) <= margin(2) + 1, `L6 ${f(margin(5))}s vs L3 ${f(margin(2))}s`);

// PRESSURE — the degenerate baselines do clearly worse.
add("reckless (ignores schedules) clears fewer levels than competent", recklessWins < compWins, `reckless ${recklessWins}/6 vs competent ${compWins}/6`);
add("reckless scores clearly below competent", recklessScore < compScore * 0.7, `reckless ${recklessScore} vs competent ${compScore}`);
add("greedy (overloads) scores clearly below competent", greedyScore < compScore * 0.85, `greedy ${greedyScore} vs competent ${compScore}`);
add(
  "greedy's weight drags its margins down (aggregate quota-time margin lower)",
  greedy.reduce((s, r) => s + (Number.isNaN(r.clockAtQuota) ? -20 : r.clockAtQuota), 0) <
    competent.reduce((s, r) => s + r.clockAtQuota, 0),
  `greedy ${f(greedy.reduce((s, r) => s + (Number.isNaN(r.clockAtQuota) ? -20 : r.clockAtQuota), 0))} vs competent ${f(competent.reduce((s, r) => s + r.clockAtQuota, 0))}`,
);

console.log("── goal checks " + "─".repeat(58));
let allOk = true;
for (const c of checks) {
  allOk = allOk && c.ok;
  console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${pad(c.label, 62)}  ${c.detail}`);
}
console.log(`\n${allOk ? "ALL GOAL CHECKS PASS" : "SOME GOAL CHECKS FAILED"}\n`);

process.exit(allOk && determinismOk && leverOk ? 0 : 1);
