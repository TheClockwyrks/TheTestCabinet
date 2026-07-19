// Automated validation for hazards.lava-not-minable.
//
// Lava is unminable: drilling into it makes no progress and never clears it. We hold down over a
// lava tile and confirm it is still lava and no cut ever begins.

import { K, newRun, SPAWN_COL, DEEPSTONE_ROW, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("hazards.lava-not-minable");
  const col = SPAWN_COL;
  const row = DEEPSTONE_ROW;

  await newRun(api);
  await api.call("teleport", col, row);
  await api.call("setTile", col, row + 1, { kind: "lava" });
  await api.call("teleport", col, row);
  await api.call("setHull", 999); // survive the contact burn during the test

  await api.call("keyDown", K.down);
  await api.step(0.8);
  await api.call("keyUp", K.down);

  const t = await api.call("tileAt", col, row + 1);
  const snap = await api.snapshot();
  check.expectEq("lava is never drilled away", t ? t.kind : null, "lava");
  check.expectEq("no cut is ever made into lava", snap.miner.drilling, null);

  await liveClip(api, 500);
  return check.verdict();
}
