// Automated validation for weight.drop-to-lift.
//
// Dropping ore from the inventory until the load falls under the lift limit clears the overload, and
// the miner can climb again. We overload the bay, drop units through the real inventory-drop path
// until it is liftable, then thrust and confirm the miner rises.

import { K, newRun, openColumn, solid, DEEPSTONE_ROW, SPAWN_COL, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("weight.drop-to-lift");
  const col = SPAWN_COL;
  const row = DEEPSTONE_ROW;

  await newRun(api);
  await api.call("teleport", col, row);
  await openColumn(api, col, row - 10, row - 1);
  await solid(api, col, row + 1);
  await api.call("teleport", col, row);
  await api.call("addCargo", "pyronium", 7); // ~406 kg — overloaded

  check.expectEq("starts overloaded", (await api.snapshot()).miner.overloaded, true);

  await api.call("dropOre", "pyronium");
  await api.call("dropOre", "pyronium");
  await api.call("dropOre", "pyronium"); // down to ~232 kg — clearly liftable
  check.expectEq("dropping ore clears the overload", (await api.snapshot()).miner.overloaded, false);

  await api.call("keyDown", K.thrust);
  await api.step(0.8);
  const after = await api.snapshot();
  await api.call("keyUp", K.thrust);
  check.expectLt("the lightened miner climbs again", after.miner.vy, -50);

  await liveClip(api, 700);
  return check.verdict();
}
