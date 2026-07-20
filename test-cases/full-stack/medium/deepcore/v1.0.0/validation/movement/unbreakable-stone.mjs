// Automated validation for movement.unbreakable-stone.
//
// An unbreakable-stone boulder is not minable: drilling into it makes no progress and never
// clears it. We stand the miner on a stone tile, hold down, run the real drill forward, and
// confirm no cut ever starts and the stone is still there.

import { K, newRun, TOPSOIL_ROW, SPAWN_COL, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("movement.unbreakable-stone");
  const col = SPAWN_COL;
  const row = TOPSOIL_ROW;

  await newRun(api);
  await api.call("teleport", col, row);
  await api.call("setTile", col, row + 1, { kind: "stone" }); // stone floor to drill into
  await api.call("teleport", col, row); // settle onto the stone
  const pre = await api.call("tileAt", col, row + 1);
  check.expectOk("the tile below is unbreakable stone", pre && pre.kind === "stone");

  await api.call("keyDown", K.down);
  await api.step(1.0);
  await api.call("keyUp", K.down);

  const after = await api.call("tileAt", col, row + 1);
  const snap = await api.snapshot();
  check.expectEq("stone is never cleared", after ? after.kind : null, "stone");
  check.expectEq("no cut is ever made on stone", snap.miner.drilling, null);
  check.expectEq("the miner has not descended", snap.miner.row, row);

  await liveClip(api, 600);
  return check.verdict();
}
