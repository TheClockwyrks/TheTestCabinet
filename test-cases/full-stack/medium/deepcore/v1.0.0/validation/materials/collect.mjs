// Automated validation for materials.collect.
//
// Drilling a material node collects the exotic material into the satchel. We place a Resonite node
// below the miner, drill it, and read the satchel back.

import { K, newRun, SPAWN_COL, ROCKBED_ROW, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("materials.collect");
  const col = SPAWN_COL;
  const row = ROCKBED_ROW;

  await newRun(api);
  await api.call("teleport", col, row);
  await api.call("setTile", col, row + 1, { kind: "material", material: "resonite" });
  await api.call("setTile", col, row + 2, { kind: "rock" });
  await api.call("teleport", col, row);
  check.expectEq("the satchel starts without Resonite", (await api.snapshot()).satchel.resonite, 0);

  await api.call("keyDown", K.down);
  const r = await stepUntil(api, (s) => s.satchel.resonite > 0, 2, 0.05);
  await api.call("keyUp", K.down);
  check.expectEq("drilling the node banks the Resonite", r.snap.satchel.resonite, 1);
  const cleared = await api.call("tileAt", col, row + 1);
  check.expectEq("the node tile clears to tunnel", cleared ? cleared.kind : null, "tunnel");

  await liveClip(api, 600);
  return check.verdict();
}
