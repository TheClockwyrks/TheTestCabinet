// Automated validation for movement.grounded-only.
//
// Drilling requires standing on solid ground: a FALLING miner does not drill. We drop the miner
// down an open shaft with the down key held and confirm that, while airborne, it is not grounded
// and no cut is in progress (so a plunge never side-drills or drills the air).

import { K, newRun, openColumn, solid, TOPSOIL_ROW, SPAWN_COL, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("movement.grounded-only");
  const col = SPAWN_COL;
  const row = TOPSOIL_ROW;

  await newRun(api);
  await api.call("teleport", col, row);
  await openColumn(api, col, row + 1, row + 4); // open shaft below → the miner falls
  await solid(api, col, row + 5);

  await api.call("keyDown", K.down);
  await api.step(0.1); // still airborne early in the fall
  const snap = await api.snapshot();
  check.expectEq("a falling miner is not grounded", snap.miner.grounded, false);
  check.expectGt("the miner is falling", snap.miner.vy, 0);
  check.expectEq("no cut happens while falling, even holding down", snap.miner.drilling, null);
  await api.call("keyUp", K.down);

  await liveClip(api, 700);
  return check.verdict();
}
