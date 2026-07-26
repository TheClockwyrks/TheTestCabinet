// Automated validation for fuel.drill-cost.
//
// Each drill hit spends fuel, and a harder band needs more hits, so a coreshell tile costs several
// times a topsoil tile at the same drill tier. We fully drill one tile in each band and compare the
// fuel spent, reading fuel the instant the tile breaks (a topsoil tile is 4 hits ≈ 1 fuel; a
// coreshell tile is 16 hits ≈ 4 fuel, at tier 1).

import {
  K,
  newRun,
  standAt,
  solid,
  TOPSOIL_ROW,
  CORESHELL_ROW,
  SPAWN_COL,
} from "../_helpers.mjs";

/**
 * ACT: drill the tile directly below once, returning the fuel spent from start to the break.
 *
 * `maxTicks` bounds the sweep. The loop cannot become `api.until` because its predicate reads
 * `tileAt` rather than the snapshot, so it stays an explicit loop advancing 3 ticks at a time
 * (3 ticks = the old 0.05 s chunk). Everything it poses first is a control op, so it is safe to
 * re-run for the second band without a reset.
 */
async function actDrillOneDown(api, col, row, maxTicks) {
  await standAt(api, col, row);
  await solid(api, col, row + 2);
  await api.call("setFuel", 999);
  const fuel0 = (await api.snapshot()).miner.fuel;
  await api.call("keyDown", K.down);
  const iters = Math.ceil(maxTicks / 3);
  for (let i = 0; i < iters; i += 1) {
    await api.advance(3);
    const t = await api.call("tileAt", col, row + 1);
    if (t && t.kind === "tunnel") break; // stop the instant the tile clears
  }
  const fuel1 = (await api.snapshot()).miner.fuel;
  await api.call("keyUp", K.down);
  return fuel0 - fuel1;
}

export default function item() {
  const col = SPAWN_COL;
  let soft;
  let hard;

  return {
    id: "fuel.drill-cost",

    async arrange(api) {
      await newRun(api);
    },

    // Both cuts are timed, so both run here — and the clip shows the soft topsoil tile giving way
    // quickly against the coreshell tile grinding, which is the comparison being asserted.
    async act(api) {
      soft = await actDrillOneDown(api, col, TOPSOIL_ROW, 90); // 90 ticks = the old 1.5 s bound
      hard = await actDrillOneDown(api, col, CORESHELL_ROW, 210); // 210 ticks = the old 3.5 s bound
    },

    async assert(api, check) {
      check.expectGt("a topsoil tile costs a modest amount of fuel", soft, 0.8);
      check.expectLt("a topsoil tile is cheap", soft, 1.9);
      check.expectGt("a coreshell tile costs far more fuel", hard, 3.8);
      check.expectGt("coreshell costs several times topsoil", hard, soft * 3);
    },
  };
}
