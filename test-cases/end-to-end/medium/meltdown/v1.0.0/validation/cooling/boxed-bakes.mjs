// Automated validation for the Surface-cooling sub-item `boxed-bakes`.
//
// A firing emitter boxed in on every face cannot shed its heat and bakes itself to
// the trip (specs/heat.md). We box an Arc with a Forge on each of its four faces
// (movers touch but never conduct or cool), give it a real Core target, and pose it
// near its redline; with zero air-facing edges and no conduction drain, its own
// firing carries it to 100 and the real trip system takes it offline.

import { newGame, build, spawn, tower, stepUntil, liveClip } from "../_helpers.mjs";

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

export default async function drive(api, ttc) {
  const check = ttc.checkOne("cooling.boxed-bakes");

  await newGame(api, "containment", "medium", 100000);
  await api.call("setLives", 100000);
  const id = await boxWithForges(api, "arc", 8, 22);
  await spawn(api, "core", "left");
  await spawn(api, "core", "left");
  await api.call("setHeat", id, 95); // near the redline; boxed, it can only rise

  const r = await stepUntil(api, (s) => s.towers.some((t) => t.id === id && t.tripped), 10);
  const t = await tower(api, id);

  check.expectOk("the boxed-in emitter baked to the trip", r.hit);
  check.expectEq("it is tripped", t.tripped, true);

  // A clip: the boxed emitter baking under fire.
  await newGame(api, "containment", "medium", 100000);
  await api.call("setLives", 100000);
  const c = await boxWithForges(api, "arc", 8, 22);
  await spawn(api, "core", "left");
  await spawn(api, "core", "left");
  await api.call("setHeat", c, 88);
  await liveClip(api, 2400);
  return check.verdict();
}
