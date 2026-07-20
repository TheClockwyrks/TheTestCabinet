// Automated validation for materials.scanner-range-tier.
//
// The scanner's range grows with its tier: a node too far to lock at the first scanner level (10
// tiles) locks once the second level (32 tiles, the full width) is bought. We bank the Resonite
// (so it is no longer needed) and place a Cryenite node 11 tiles away — nearer than the guaranteed
// deepstone Cryenite — then compare the first vs the second scanner level.

import { newRun, SPAWN_COL, ROCKBED_ROW, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("materials.scanner-range-tier");
  const col = SPAWN_COL;
  const row = ROCKBED_ROW;

  await newRun(api);
  await api.call("teleport", col, row);
  await api.call("giveMaterial", "resonite"); // so only Cryenite is still needed
  await api.call("setTile", col + 11, row, { kind: "material", material: "cryenite" }); // 11 tiles east

  await api.call("grantGear", { scanner: 2 }); // range 10 tiles → 11 is out of range
  check.expectEq("out of range at the first scanner level — no lock", (await api.snapshot()).scanner.locked, false);

  await api.call("grantGear", { scanner: 3 }); // range 32 tiles (full width) → 11 is now in range
  const s = (await api.snapshot()).scanner;
  check.expectEq("the wider second level locks from farther", s.locked, true);
  check.expectEq("it targets the Cryenite", s.target, "cryenite");

  await liveClip(api, 600);
  return check.verdict();
}
