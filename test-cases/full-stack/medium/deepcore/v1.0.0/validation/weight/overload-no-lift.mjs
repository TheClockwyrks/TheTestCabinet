// Automated validation for weight.overload-no-lift.
//
// When the cargo weight meets or exceeds the jetpack's lift limit the miner is OVERLOADED: thrust
// can only slow the descent, not climb. We load past the tier-1 lift limit, confirm the overload
// flag, then hold thrust and confirm the miner does not rise.

import { K, newRun, openColumn, solid, DEEPSTONE_ROW, SPAWN_COL, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("weight.overload-no-lift");
  const col = SPAWN_COL;
  const row = DEEPSTONE_ROW;

  await newRun(api);
  await api.call("teleport", col, row);
  await openColumn(api, col, row - 10, row - 1);
  await solid(api, col, row + 1);
  await api.call("teleport", col, row);
  await api.call("addCargo", "pyronium", 7); // ~406 kg — over the 350 kg tier-1 lift limit

  const before = await api.snapshot();
  check.expectEq("the load exceeds lift — OVERLOADED", before.miner.overloaded, true);

  await api.call("keyDown", K.thrust);
  await api.step(1.0);
  const after = await api.snapshot();
  await api.call("keyUp", K.thrust);
  check.expectGe("an overloaded miner cannot climb", after.miner.row, row);
  check.expectGt("thrust cannot pull it upward", after.miner.vy, -20);

  await liveClip(api, 700);
  return check.verdict();
}
