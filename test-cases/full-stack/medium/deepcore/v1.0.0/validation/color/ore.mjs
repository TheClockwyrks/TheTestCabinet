// Automated validation for color.ore.
//
// An ore vein renders in a color clearly distinct from the plain band rock around it. We set a bright
// ore against topsoil rock and confirm the vein registers somewhere across the tile (its smear may
// cover only part of the tile) against the plain-rock color.

import { newRun, solid, sampleTile, tileMaxDistFrom, SPAWN_COL, TOPSOIL_ROW } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("color.ore");
  const col = SPAWN_COL;
  const row = TOPSOIL_ROW;

  await newRun(api);
  await api.call("teleport", col, row);
  await api.call("setTile", col + 2, row, { kind: "ore", ore: "cuprite" });
  await solid(api, col + 3, row);
  await api.wait(120);

  const rock = await sampleTile(api, col + 3, row);
  const oreDist = await tileMaxDistFrom(api, col + 2, row, rock);
  check.expectGt("an ore vein reads against plain rock", oreDist, 30);

  await api.screenshot("ore");
  return check.verdict();
}
