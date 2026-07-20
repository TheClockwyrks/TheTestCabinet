// Automated validation for fuel.drill-cost.
//
// Each drill hit spends fuel, and a harder band needs more hits, so a coreshell tile costs several
// times a topsoil tile at the same drill tier. We fully drill one tile in each band and compare the
// fuel spent, reading fuel the instant the tile breaks (a topsoil tile is 4 hits ≈ 1 fuel; a
// coreshell tile is 16 hits ≈ 4 fuel, at tier 1).

import { K, newRun, standAt, solid, TOPSOIL_ROW, CORESHELL_ROW, SPAWN_COL } from "../_helpers.mjs";

/** Drill the tile directly below once, returning the fuel spent from start to the break. */
async function drillOneDown(api, col, row, maxSec) {
  await standAt(api, col, row);
  await solid(api, col, row + 2);
  await api.call("setFuel", 999);
  const fuel0 = (await api.snapshot()).miner.fuel;
  await api.call("keyDown", K.down);
  const iters = Math.ceil(maxSec / 0.05);
  for (let i = 0; i < iters; i += 1) {
    await api.step(0.05);
    const t = await api.call("tileAt", col, row + 1);
    if (t && t.kind === "tunnel") break; // stop the instant the tile clears
  }
  const fuel1 = (await api.snapshot()).miner.fuel;
  await api.call("keyUp", K.down);
  return fuel0 - fuel1;
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("fuel.drill-cost");
  const col = SPAWN_COL;

  await newRun(api);
  const soft = await drillOneDown(api, col, TOPSOIL_ROW, 1.5);
  const hard = await drillOneDown(api, col, CORESHELL_ROW, 3.5);

  check.expectGt("a topsoil tile costs a modest amount of fuel", soft, 0.8);
  check.expectLt("a topsoil tile is cheap", soft, 1.9);
  check.expectGt("a coreshell tile costs far more fuel", hard, 3.8);
  check.expectGt("coreshell costs several times topsoil", hard, soft * 3);

  await api.call("setAutoStep", true);
  await api.wait(500);
  return check.verdict();
}
