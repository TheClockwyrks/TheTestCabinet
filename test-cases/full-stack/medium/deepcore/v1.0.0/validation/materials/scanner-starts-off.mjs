// Automated validation for materials.scanner-starts-off.
//
// You start with NO scanner (tier 1 = no scanner), so nothing ever locks — even right beside a
// needed material. Buying the first scanner level enables the lock. We place a Resonite node one
// tile east, confirm no lock at the start, then buy the first level and confirm it locks on.

import { newRun, SPAWN_COL, ROCKBED_ROW, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("materials.scanner-starts-off");
  const col = SPAWN_COL;
  const row = ROCKBED_ROW;

  await newRun(api); // fresh expedition — every track at tier 1, so no scanner
  await api.call("teleport", col, row);
  await api.call("setTile", col + 1, row, { kind: "material", material: "resonite" }); // one tile east

  check.expectEq("no scanner at the start — nothing locks even beside a node", (await api.snapshot()).scanner.locked, false);

  await api.call("grantGear", { scanner: 2 }); // buy the first scanner level (range 10)
  const s = (await api.snapshot()).scanner;
  check.expectEq("buying the first level enables the lock", s.locked, true);
  check.expectEq("it targets the needed Resonite", s.target, "resonite");

  await liveClip(api, 700);
  return check.verdict();
}
