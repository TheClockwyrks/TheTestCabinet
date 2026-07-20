// Automated validation for movement.drill-side.
//
// A side (left/right) cut begins only once the miner is flush against the tile edge: pressing
// sideways from mid-tile WALKS first and does not drill on the keypress. We confirm the very
// first tick moves the miner without a cut, then a cut against the wall begins shortly after.

import { K, newRun, standAt, solid, TOPSOIL_ROW, SPAWN_COL, TICK, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("movement.drill-side");
  const col = SPAWN_COL;
  const row = TOPSOIL_ROW;

  await newRun(api);
  await standAt(api, col, row); // grounded, centered in its tile
  await solid(api, col + 1, row); // a rock wall to the right to drill into

  const x0 = (await api.snapshot()).miner.x;
  await api.call("keyDown", K.right);
  await api.step(TICK); // one tick: mid-tile, so it should walk, not drill
  const first = (await api.snapshot()).miner;
  check.expectEq("no cut on the keypress from mid-tile (walks first)", first.drilling, null);
  check.expectGt("the miner is walking toward the edge", first.x - x0, 0);

  await api.step(0.3); // reaches the edge and commits to the cut
  const cutting = (await api.snapshot()).miner;
  check.expectOk("a side cut has begun once flush", !!cutting.drilling && cutting.drilling.dir === "right");
  await api.call("keyUp", K.right);

  await liveClip(api, 700);
  return check.verdict();
}
