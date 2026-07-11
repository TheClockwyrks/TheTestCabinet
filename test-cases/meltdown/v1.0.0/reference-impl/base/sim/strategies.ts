// Meltdown — sim controllers (declarative layouts consumed by the harness).
// These span the spectrum from no-maze to fed-maze+heat so the harness can
// check the two design goals.

import { aceController } from "./ace";
import type { BuildOrder, Controller } from "./harness";
import { layoutController } from "./harness";
import { flankLayout } from "./mazes";

// A dense "battery" that lines both straight lanes with guns two-deep and adds
// Flak (air) and Bloom (splash) — a maxed-out NO-MAZE defence (path never
// lengthened). If this can win, the game does not require mazing.
export function flankBatteryLayout(): BuildOrder[] {
  const o: BuildOrder[] = [];
  // L->R lane rows 16..19. Two-deep above (rows 14,12) and below (rows 20,22).
  for (let c = 2; c <= 46; c += 2) {
    o.push({ type: "arc", col: c, row: 14, rot: 0, level: 3 });
    o.push({ type: "arc", col: c, row: 20, rot: 0, level: 3 });
    o.push({ type: "arc", col: c, row: 12, rot: 0, level: 2, minWave: 6 });
    o.push({ type: "arc", col: c, row: 22, rot: 0, level: 2, minWave: 6 });
  }
  // T->B lane cols 22..29. Flank left (col 20,18) and right (col 30,32).
  for (let r = 2; r <= 32; r += 2) {
    o.push({ type: "arc", col: 20, row: r, rot: 1, level: 3 });
    o.push({ type: "arc", col: 30, row: r, rot: 1, level: 3 });
    o.push({ type: "arc", col: 18, row: r, rot: 1, level: 2, minWave: 6 });
    o.push({ type: "arc", col: 32, row: r, rot: 1, level: 2, minWave: 6 });
  }
  // Air cover along both flight lines, and splash at the crossing for swarms.
  o.push({ type: "flak", col: 6, row: 24, level: 3, minWave: 5 });
  o.push({ type: "flak", col: 44, row: 24, level: 3, minWave: 5 });
  o.push({ type: "flak", col: 24, row: 6, level: 3, minWave: 5 });
  o.push({ type: "flak", col: 24, row: 30, level: 3, minWave: 5 });
  return o;
}

export function controllerSet(): Controller[] {
  return [
    { name: "no-towers", build() {} },
    layoutController("flank-no-maze", flankLayout(), { note: "guns line the lanes, no mazing", early: true }),
    layoutController("flank-battery", flankBatteryLayout(), { note: "MAX no-maze: 2-deep lanes, flak, upgrades", early: true }),
    aceController(false),
    aceController(true),
  ];
}
