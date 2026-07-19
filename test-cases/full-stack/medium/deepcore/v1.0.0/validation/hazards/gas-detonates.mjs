// Automated validation for hazards.gas-detonates.
//
// Drilling into a gas pocket detonates it, dealing hull damage and knocking the miner back. We set
// a gas tile below the miner, drill it, and read the hull drop and the cleared tile back.

import { K, newRun, standAt, SPAWN_COL, ROCKBED_ROW, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("hazards.gas-detonates");
  const col = SPAWN_COL;
  const row = ROCKBED_ROW;

  await newRun(api);
  await standAt(api, col, row);
  await api.call("setTile", col, row + 1, { kind: "gas" });
  await api.call("setTile", col, row + 2, { kind: "rock" });
  await api.call("teleport", col, row);
  await api.call("grantGear", { hull: 3 }); // survive the deadly rockbed gas so the knockback reads
  const hull0 = (await api.snapshot()).miner.hull;

  await api.call("keyDown", K.down);
  const r = await stepUntil(api, (s) => s.miner.hull < hull0, 3, 0.05);
  await api.call("keyUp", K.down);

  check.expectLt("the detonation costs hull", r.snap.miner.hull, hull0);
  const cleared = await api.call("tileAt", col, row + 1);
  check.expectEq("the gas tile clears to tunnel", cleared ? cleared.kind : null, "tunnel");

  await liveClip(api, 700);
  return check.verdict();
}
