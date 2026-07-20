// Automated validation for hud.scanner-indicator — the scanner direction/distance indicator is drawn
// only while locked onto a needed material, and hidden otherwise. We confirm no lock when far from a
// node, then a lock beside one, and record the locked indicator for the reviewer to eye.

import { newRun, SPAWN_COL, ROCKBED_ROW, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("hud.scanner-indicator");

  await newRun(api);
  await api.call("grantGear", { scanner: 3 });
  await api.call("teleport", 2, 60); // far from either buried node
  check.expectEq("no indicator when nothing is in range", (await api.snapshot()).scanner.locked, false);

  await api.call("teleport", SPAWN_COL, ROCKBED_ROW);
  await api.call("setTile", SPAWN_COL + 1, ROCKBED_ROW, { kind: "material", material: "resonite" });
  check.expectEq("the indicator shows once locked on", (await api.snapshot()).scanner.locked, true);

  await liveClip(api, 900); // record the drawn indicator
  return check.verdict();
}
