// Automated validation for economy.ore-to-cargo.
//
// Drilling an ore vein banks one unit into the cargo bay, using one slot. We set an ore tile below
// the miner, drill it, and read the cargo back.

import { K, newRun, SPAWN_COL, TOPSOIL_ROW, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("economy.ore-to-cargo");
  const col = SPAWN_COL;
  const row = TOPSOIL_ROW;

  await newRun(api);
  await api.call("teleport", col, row);
  await api.call("setTile", col, row + 1, { kind: "ore", ore: "ferron" });
  await api.call("setTile", col, row + 2, { kind: "rock" });
  await api.call("teleport", col, row);
  check.expectEq("the bay starts empty", (await api.snapshot()).cargo.slotsUsed, 0);

  await api.call("keyDown", K.down);
  const r = await stepUntil(api, (s) => s.cargo.slotsUsed > 0, 2, 0.05);
  await api.call("keyUp", K.down);
  check.expectEq("drilling ore fills one slot", r.snap.cargo.slotsUsed, 1);
  check.expectEq("the ferron unit is banked", r.snap.cargo.ore.ferron, 1);

  await liveClip(api, 600);
  return check.verdict();
}
