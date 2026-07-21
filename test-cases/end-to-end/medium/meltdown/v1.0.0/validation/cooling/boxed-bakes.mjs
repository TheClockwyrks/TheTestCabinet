// Automated validation for the Surface-cooling sub-item `boxed-bakes`.
//
// A firing emitter boxed in on every face cannot shed its heat and bakes itself to
// the trip (specs/heat.md). We box an Arc with a Forge on each of its four faces
// (movers touch but never conduct or cool), give it a real Core target, and pose it
// near its redline; with zero air-facing edges and no conduction drain, its own
// firing carries it to 100 and the real trip system takes it offline.

import { newGame, build, spawn, tower, TICK } from "../_helpers.mjs";

// Box `col,row` (a 2x2 emitter) with a Forge on N, S, W, and E. Returns the
// emitter's id.
async function boxWithForges(api, type, col, row) {
  const id = await build(api, type, col, row);
  await build(api, "forge", col, row - 2); // N
  await build(api, "forge", col, row + 2); // S
  await build(api, "forge", col - 2, row); // W
  await build(api, "forge", col + 2, row); // E
  return id;
}

export default function item() {
  let towerId;
  let r;
  let t;

  return {
    id: "cooling.boxed-bakes",

    // A boxed-in Arc with two real Cores to fire at, posed at 95 — with no open face
    // and no conduction drain, its own firing can only carry it up.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      towerId = await boxWithForges(api, "arc", 8, 22);
      await spawn(api, "core", "left");
      await spawn(api, "core", "left");
      await api.call("setHeat", towerId, 95); // near the redline; boxed, it can only rise
    },

    // Let the real firing/heat systems bake it to the trip. 600 ticks = the old 10s
    // cap; polling every tick catches the exact step it goes offline.
    async act(api) {
      r = await api.until(
        (s) => s.towers.some((t2) => t2.id === towerId && t2.tripped),
        { max: 600, poll: TICK },
      );
      t = await tower(api, towerId);
    },

    async assert(api, check) {
      check.expectOk("the boxed-in emitter baked to the trip", r.hit);
      check.expectEq("it is tripped", t.tripped, true);
    },
  };
}
