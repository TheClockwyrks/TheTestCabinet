// Automated validation for materials.scanner-locks.
//
// With a needed material in range the scanner locks on, naming the material and pointing toward it.
// We place a Resonite node one tile east of the miner and confirm the scanner locks with the right
// target and an eastward direction.

import { newRun, SPAWN_COL, ROCKBED_ROW, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("materials.scanner-locks");
  const col = SPAWN_COL;
  const row = ROCKBED_ROW;

  await newRun(api);
  await api.call("grantGear", { scanner: 3 }); // the widest scanner so the near node is in reach
  await api.call("teleport", col, row);
  await api.call("setTile", col + 1, row, { kind: "material", material: "resonite" }); // one tile east

  const s = (await api.snapshot()).scanner;
  check.expectEq("the scanner locks on", s.locked, true);
  check.expectEq("it targets the needed Resonite", s.target, "resonite");
  check.expectGt("it points toward the node (east)", s.dirX, 0);

  await liveClip(api, 700);
  return check.verdict();
}
