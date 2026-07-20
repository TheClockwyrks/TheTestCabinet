// Automated validation for color.stone.
//
// An unbreakable-stone boulder renders in a color distinct from the diggable band dirt around it, so
// it is not mistaken for ordinary rock. We sample a stone tile and an adjacent topsoil rock tile.

import { newRun, solid, sampleTile, colorDistance, SPAWN_COL, TOPSOIL_ROW } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("color.stone");
  const col = SPAWN_COL;
  const row = TOPSOIL_ROW;

  await newRun(api);
  await api.call("teleport", col, row);
  await api.call("setTile", col + 2, row, { kind: "stone" });
  await solid(api, col + 3, row);
  await api.wait(120);

  const stone = await sampleTile(api, col + 2, row);
  const rock = await sampleTile(api, col + 3, row);
  check.expectGt("stone is distinct from the band dirt", colorDistance(stone, rock), 28);

  await api.screenshot("stone");
  return check.verdict();
}
