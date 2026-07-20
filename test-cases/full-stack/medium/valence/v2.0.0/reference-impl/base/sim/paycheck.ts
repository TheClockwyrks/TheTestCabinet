// Verify the damage-proportional economy against each specified case, driving the real
// damage paths in src/sim.ts. Payment is by damage dealt, capped at what was actually
// there to remove; a bond pool pays nothing while draining and its whole value on break.
import { Game } from "../src/sim";
import { MODE } from "../src/mode";
import { mapById } from "../src/board";

interface Probe {
  damageUnit(u: unknown, amount: number, t: string, p: { x: number; y: number }): void;
  bondDamage(u: unknown, amount: number, x: number, y: number): void;
}

function spawn(type: string, electrons?: number) {
  const g = new Game(MODE, mapById("single")!);
  g.start();
  g.startRound();
  const id = g.debugSpawnUnit({ type, electrons, pathId: 0, progress: 0.5 });
  const u = g.units.find((x) => x.id === id)!;
  return { g, u, probe: g as unknown as Probe };
}

const results: { name: string; want: number; got: number }[] = [];

function shellCase(name: string, electrons: number, dmg: number, want: number) {
  const { g, u, probe } = spawn("atom", electrons);
  const before = g.energy;
  probe.damageUnit(u, dmg, "energy", { x: 0, y: 0 });
  results.push({ name, want, got: g.energy - before });
}

function bondCase(name: string, dmg: number, want: (maxBond: number) => number, preBond?: number) {
  const { g, u, probe } = spawn("dimer");
  const maxBond = u.maxBondHP;
  if (preBond != null) u.bondHP = preBond;
  const before = g.energy;
  probe.bondDamage(u, dmg, 0, 0);
  results.push({ name, want: want(maxBond), got: g.energy - before });
}

shellCase("1 dmg shot -> $1", 1, 1, 1);
shellCase("1 dmg shot on 2HP enemy -> $1", 2, 1, 1);
shellCase("2 dmg shot on 2HP enemy -> $2", 2, 2, 2);
shellCase("2 dmg shot on 1HP enemy -> $1 (overkill unpaid)", 1, 2, 1);
bondCase("1 dmg on a health buffer -> $0", 1, () => 0);
bondCase("1 dmg that breaks the buffer -> $X", 1, (x) => x, 1);
bondCase("2 dmg on a buffer with 1 left -> $X (overkill unpaid)", 2, (x) => x, 1);

let failed = 0;
for (const r of results) {
  const ok = r.got === r.want;
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${r.name.padEnd(52)} want ${r.want}  got ${r.got}`);
}
console.log(failed === 0 ? "\n  all payment cases pass" : `\n  ${failed} FAILED`);
