// Meltdown — geometry/heat probe.  npx tsx sim/probe.ts
//
// Builds a layout in a fresh game (with unlimited money so the whole layout
// lands) and reports the shortest surge path length for each stream and each
// emitter's steady-state heat under continuous fire — so maze geometry and
// thermal placement can be designed from numbers, not guesses.

import { BASE_K, RAD_K, REDLINE } from "../src/constants";
import type { BuildOrder } from "./harness";
import { newGame } from "./harness";
import { flankLayout, serpManagedLayout, serpSolidLayout } from "./mazes";

function pathLen(orders: BuildOrder[]): { lr: number; tb: number; built: number; blocked: number } {
  const g = newGame();
  g.beginMatch();
  g.money = 1e9; // fund the whole layout
  let built = 0;
  for (const o of orders) {
    const t = g.build(o.type, o.col, o.row, o.rot ?? 0);
    if (t) built++;
  }
  const right = g.fieldForGoal("right");
  const bottom = g.fieldForGoal("bottom");
  const lr = Math.min(...g["grid"].leftVent.tiles.map((t: number) => right[t]));
  const tb = Math.min(...g["grid"].topVent.tiles.map((t: number) => bottom[t]));
  return { lr, tb, built, blocked: orders.length - built };
}

// Continuous-fire steady-state heat for each emitter: solve gain = loss.
// gain = heatPerShot * fireRate  (per second, before /mass — mass cancels at
// equilibrium). loss(H) = (RAD_K*airRad + BASE_K*airBase + sum sinkOut)* H/100
// plus conduction toward neighbors (approximated as 0 at equilibrium when the
// block is uniform). We ignore Forge here (thermostat) for a floor read.
function steadyHeat(orders: BuildOrder[]): void {
  const g = newGame();
  g.beginMatch();
  g.money = 1e9;
  for (const o of orders) g.build(o.type, o.col, o.row, o.rot ?? 0);
  // recomputeAdjacency already ran on each build.
  const emitters = g.towers.filter((t) => t.isEmitter);
  const buckets = new Map<string, { n: number; hSum: number; trip: number }>();
  for (const e of emitters) {
    const s = e.stats();
    const gain = s.heatPerShot * s.fireRate; // continuous fire
    let coolCoeff = RAD_K * e.airRadEdges + BASE_K * e.airBaseEdges;
    for (const l of e.sinkLinks) coolCoeff += l.other.moverOutput() * l.edges;
    // H* where gain = coolCoeff * H/100  -> H = 100*gain/coolCoeff
    const Hstar = coolCoeff > 0 ? (100 * gain) / coolCoeff : Infinity;
    const key = `${e.type}`;
    const b = buckets.get(key) ?? { n: 0, hSum: 0, trip: 0 };
    b.n++;
    b.hSum += Math.min(Hstar, 200);
    if (Hstar >= REDLINE) b.trip++;
    buckets.set(key, b);
  }
  for (const [k, b] of buckets) {
    console.log(`    ${k.padEnd(8)} n=${String(b.n).padStart(2)}  mean H*=${(b.hSum / b.n).toFixed(0).padStart(3)}  would-trip(contfire): ${b.trip}/${b.n}`);
  }
}

function report(name: string, orders: BuildOrder[]): void {
  const p = pathLen(orders);
  console.log(`\n### ${name}  (orders ${orders.length}, built ${p.built}, rejected ${p.blocked})`);
  console.log(`    path  L->R ${p.lr.toFixed(1)}   T->B ${p.tb.toFixed(1)}   (straight ~49 / ~35)`);
  steadyHeat(orders);
}

report("flank", flankLayout());
report("serp-solid", serpSolidLayout());
report("serp-managed", serpManagedLayout());
