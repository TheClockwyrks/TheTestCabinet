// Automated validation for materials.scanner-range-tier.
//
// The scanner's range grows with its tier: a node too far to lock at a low tier locks once the tier
// is raised. We bank the Resonite (so it is no longer needed) and place a Cryenite node 11 tiles
// away — nearer than the guaranteed deepstone Cryenite — then compare a low vs high scanner tier.

import { newRun, SPAWN_COL, ROCKBED_ROW, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("materials.scanner-range-tier");
  const col = SPAWN_COL;
  const row = ROCKBED_ROW;

  await newRun(api);
  await api.call("teleport", col, row);
  await api.call("giveMaterial", "resonite"); // so only Cryenite is still needed
  await api.call("setTile", col + 11, row, { kind: "material", material: "cryenite" }); // 11 tiles east

  await api.call("grantGear", { scanner: 1 }); // range 6 tiles → 11 is out of range
  check.expectEq("out of range at a low tier — no lock", (await api.snapshot()).scanner.locked, false);

  await api.call("grantGear", { scanner: 3 }); // range 20 tiles → 11 is now in range
  const s = (await api.snapshot()).scanner;
  check.expectEq("a higher tier locks from farther", s.locked, true);
  check.expectEq("it targets the Cryenite", s.target, "cryenite");

  await liveClip(api, 600);
  return check.verdict();
}
