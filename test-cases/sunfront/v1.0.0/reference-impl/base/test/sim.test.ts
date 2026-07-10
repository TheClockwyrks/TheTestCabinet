/**
 * Sunfront — headless simulation invariants (the Phase-4 build gate).
 *
 * Steps the pure {@link World} (no THREE, no DOM) and asserts the load-bearing rules
 * from the specs: income accrual (specs/economy.md), the counter matrix including a
 * `—` cannot-target block (specs/units.md), splash hitting multiple victims, a wave
 * emitting one unit per spawner (specs/waves.md), two equal armies grinding to a rough
 * stalemate near centre, the Reliquary `+700` bounty and its Aegis (own-half + rarity
 * guard), and a razed base ending the match (specs/flow.md).
 *
 * Run via `test/run.mjs` (esbuild-bundled, then executed on node); it exits non-zero
 * on any failed assertion so `npm test` fails loudly.
 */

import { World, counterMult, levelBonus, upgradeCost, other } from "../src/sim/world";
import {
  START_SOL,
  PASSIVE_INCOME_PER_S,
  RELIQUARY_BOUNTY,
  UNIT_STATS,
  SPAWNER_LEVEL_BONUS,
  MIDLINE_SUM,
} from "../src/constants";
import { facingYaw, advanceDir } from "../src/mathutil";

// --- Tiny assertion harness -------------------------------------------------

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(cond: boolean, msg: string): void {
  if (cond) { passed++; return; }
  failed++;
  failures.push(msg);
  console.error(`  ✗ ${msg}`);
}

function near(actual: number, expected: number, tol: number, msg: string): void {
  check(Math.abs(actual - expected) <= tol, `${msg} (got ${actual.toFixed(3)}, want ${expected}±${tol})`);
}

function section(name: string, fn: () => void): void {
  console.log(`• ${name}`);
  fn();
}

/** Step a world forward `seconds` at a fixed frame time (frame-rate independent). */
function run(w: World, seconds: number, dt = 1 / 60): void {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) w.step(dt);
}

const yawFor = (team: "player" | "enemy") => facingYaw(advanceDir(team));

// --- 1. Income accrual (specs/economy.md) -----------------------------------

section("income accrues at 10 sol/s, +Extractor bonus, no wave bump", () => {
  const w = new World();
  check(w.sol.player === START_SOL, "starts with 200 sol");
  check(w.incomeRate("player") === PASSIVE_INCOME_PER_S, "base rate is 10/s");
  run(w, 1);
  near(w.sol.player, START_SOL + 10, 0.2, "passive income over 1 s is +10");

  // A level-1 Solar Extractor lifts the rate to 14/s and costs 180.
  const before = w.sol.player;
  const ext = w.place("player", "solar-extractor", 0, 1)!;
  check(!!ext, "placed a Solar Extractor");
  near(w.sol.player, before - 180, 0.001, "Extractor costs 180");
  check(w.incomeRate("player") === 14, "rate is 14/s at Extractor L1");
  const s0 = w.sol.player;
  run(w, 1);
  near(w.sol.player - s0, 14, 0.2, "income over 1 s is +14 with Extractor L1");

  // Upgrades: 135/level, income 7 then 10 total.
  w.sol.player = 1000;
  w.upgrade(ext);
  check(w.incomeRate("player") === 17, "rate is 17/s at Extractor L2 (10+7)");
  w.upgrade(ext);
  check(w.incomeRate("player") === 20, "rate is 20/s at Extractor L3 (10+10)");
  check(!w.upgrade(ext), "cannot upgrade past level 3");
});

// --- 2. Counter matrix incl. a '—' cannot-target block (specs/units.md) -----

section("counter matrix multipliers and the '—' blocks", () => {
  check(counterMult("Normal", "Light") === 1.0, "Normal vs Light = 1.0");
  check(counterMult("Normal", "Heavy") === 0.75, "Normal vs Heavy = 0.75");
  check(counterMult("Normal", "Air") === null, "Normal vs Air = — (cannot target)");
  check(counterMult("Piercing", "Heavy") === 1.5, "Piercing vs Heavy = 1.5");
  check(counterMult("Piercing", "Air") === null, "Piercing vs Air = —");
  check(counterMult("Splash", "Light") === 1.5, "Splash vs Light = 1.5");
  check(counterMult("Splash", "Heavy") === 0.75, "Splash vs Heavy = 0.75");
  check(counterMult("Flak", "Air") === 2.0, "Flak vs Air = 2.0");
  check(counterMult("Flak", "Light") === 0.5, "Flak vs Light = 0.5");
  check(counterMult("Support", "Light") === null, "Support deals no damage (—)");
  check(levelBonus(1) === 1 && levelBonus(2) === 1.3 && levelBonus(3) === 1.6, "level bonus 0/30/60%");

  // Integration: a Normal ground attacker cannot touch an Air Sunhawk (the '—' block),
  // while the Sunhawk shoots the ground unit down. Air is only hit by Flak.
  const w = new World();
  const scarab = w.spawnUnit("player", "scarab", 1, { x: 600, z: 600 }, yawFor("player"));
  const hawk = w.spawnUnit("enemy", "sunhawk", 1, { x: 622, z: 618 }, yawFor("enemy"));
  run(w, 3);
  check(hawk.hp === hawk.maxHp, "Sunhawk (Air) took no damage from a Normal attacker — the '—' block");
  check(scarab.dead || scarab.hp < scarab.maxHp, "the Sunhawk shot the ground Scarab (Normal vs Light)");

  // And a Flakhound melts the same Air unit (Flak vs Air = 2.0).
  const w2 = new World();
  const flak = w2.spawnUnit("player", "flakhound", 1, { x: 600, z: 600 }, yawFor("player"));
  const hawk2 = w2.spawnUnit("enemy", "sunhawk", 1, { x: 640, z: 640 }, yawFor("enemy"));
  run(w2, 2);
  check(hawk2.hp < hawk2.maxHp, "Flakhound damaged the Air Sunhawk (Flak counters Air)");
  check(!flak.dead, "Flakhound survived the exchange");
});

// --- 3. Splash hits multiple enemies (specs/units.md) -----------------------

section("splash damages every enemy within the radius", () => {
  const w = new World();
  w.spawnUnit("player", "bombard", 1, { x: 300, z: 300 }, yawFor("player"));
  // Three slow Heavy Bulwarks clustered within the 55-unit splash radius, in range
  // (~198 units) and beyond the Bombard's 70 minimum range.
  const a = w.spawnUnit("enemy", "bulwark", 1, { x: 440, z: 420 }, yawFor("enemy"));
  const b = w.spawnUnit("enemy", "bulwark", 1, { x: 440, z: 440 }, yawFor("enemy"));
  const c = w.spawnUnit("enemy", "bulwark", 1, { x: 440, z: 460 }, yawFor("enemy"));
  run(w, 2.2); // one Bombard shot lands at ~2.0 s
  const hurt = [a, b, c].filter((u) => u.hp < u.maxHp).length;
  check(hurt >= 2, `a single Bombard shot damaged ${hurt} clustered enemies via splash`);
});

// --- 4. A wave emits one unit per spawner (specs/waves.md) -------------------

section("a wave emits one unit per spawner, at its level; Extractors emit nothing", () => {
  const w = new World();
  w.sol.player = 1e6;
  w.place("player", "scarab", 0, 0);
  const trooperSpawner = w.place("player", "trooper", 1, 0)!;
  w.place("player", "sentinel", 2, 0);
  w.place("player", "solar-extractor", 3, 0); // must NOT emit a unit
  w.upgrade(trooperSpawner); // level 2 -> its unit carries the +30% HP
  near(w.sol.player, 1e6 - UNIT_STATS.trooper.cost, 1e6, "trooper spawner build cost deducted");
  check(upgradeCost("trooper") === Math.round(UNIT_STATS.trooper.cost * 0.75), "spawner upgrade = 75% of cost");

  w.fireWave();
  const mine = w.units.filter((u) => u.team === "player");
  check(mine.length === 3, `wave emitted one unit per spawner (3), got ${mine.length}`);
  const types = new Set(mine.map((u) => u.type));
  check(types.has("scarab") && types.has("trooper") && types.has("sentinel"), "one of each spawner's type");
  const trooper = mine.find((u) => u.type === "trooper")!;
  check(trooper.level === 2, "emitted trooper carries its spawner's level 2");
  near(trooper.maxHp, UNIT_STATS.trooper.hp * (1 + SPAWNER_LEVEL_BONUS[1]), 0.001, "level-2 trooper has +30% HP");
});

// --- 5. Two equal armies grind to a rough stalemate near centre -------------

section("two mirrored armies stalemate near the centre of the diagonal", () => {
  const w = new World();
  w.sol.player = 1e6;
  w.sol.enemy = 1e6;
  const mirror: Array<"scarab" | "sentinel" | "bulwark" | "lancer"> = ["scarab", "sentinel", "bulwark", "lancer"];
  for (const team of ["player", "enemy"] as const) {
    mirror.forEach((t, i) => w.place(team, t, i, 0));
  }
  // Stamp several identical waves for both sides, then let them fight.
  for (let k = 0; k < 3; k++) w.fireWave();
  run(w, 25);

  check(w.result === null, "neither base has fallen — it is a grind, not a rout");
  check(w.bases.player.hp > 0 && w.bases.enemy.hp > 0, "both bases still stand");
  const alive = w.units.filter((u) => !u.dead);
  check(alive.length > 0, "units are still fighting");
  if (alive.length > 0) {
    const meanSum = alive.reduce((s, u) => s + u.x + u.z, 0) / alive.length;
    near(meanSum, MIDLINE_SUM, 260, "the front line sits near the centre (x+z ≈ 1200)");
  }
});

// --- 6. Reliquary bounty + Aegis, own-half, and the rarity guard ------------

section("razing the enemy Reliquary pays +700 and spawns the loser's own-half Aegis", () => {
  const w = new World();
  const solBefore = w.sol.player;
  // Bring the enemy Reliquary to 0; the destroyer is the player.
  w.reliquaries.enemy.hp = 0;
  w.step(1 / 60);
  near(w.sol.player, solBefore + RELIQUARY_BOUNTY + w.incomeRate("player") / 60, 1, "player paid +700 sol");
  check(w.aegisCountFor("enemy") === 1, "the losing (enemy) side gained one Aegis");
  check(other("enemy") === "player", "destroyer/other() sanity");

  // The guard: a side cannot gain a second Aegis.
  w.reliquaries.enemy.hp = 0;
  w.step(1 / 60);
  check(w.aegisCountFor("enemy") === 1, "no second Aegis for the same side");

  // Aegis stays on its own half while hunting enemies that crossed onto it.
  const aegis = w.aegis[0]!;
  // Drop a few player units deep on the enemy's half for the Aegis to engage.
  for (let i = 0; i < 5; i++) {
    w.spawnUnit("player", "scarab", 1, { x: 900 + i * 6, z: 900 }, yawFor("player"));
  }
  const targetHpBefore = w.units.filter((u) => u.team === "player").reduce((s, u) => s + u.hp, 0);
  run(w, 4);
  check(aegis.x + aegis.z >= MIDLINE_SUM - 2, "Aegis never crossed onto the player's half (stays x+z ≥ 1200)");
  const targetHpAfter = w.units.filter((u) => u.team === "player" && !u.dead).reduce((s, u) => s + u.hp, 0);
  check(targetHpAfter < targetHpBefore, "the Aegis turrets damaged enemies on its half");

  // At most two Aegi across the match (one per side).
  w.reliquaries.player.hp = 0;
  w.step(1 / 60);
  check(w.aegis.length === 2, "at most two Aegi exist across a match (one per side)");
});

// --- 7. A razed base ends the match (specs/flow.md) -------------------------

section("razing a base ends the match with the right winner", () => {
  const w = new World();
  // A cluster of player Lancers next to the undefended enemy base.
  for (let i = 0; i < 5; i++) {
    w.spawnUnit("player", "lancer", 1, { x: 1010 + i * 4, z: 1010 }, yawFor("player"));
  }
  run(w, 20);
  check(w.result === "player", `enemy base razed -> player victory (result=${w.result})`);
  check(w.bases.enemy.hp <= 0, "enemy base is at 0 HP");
});

// --- Report -----------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(`\nFAILURES:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log("All simulation invariants hold. ✓");
}
