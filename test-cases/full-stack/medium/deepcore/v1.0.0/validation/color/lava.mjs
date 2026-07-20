// Automated validation for color.lava.
//
// Lava renders in a distinct, bright color clearly different from the surrounding rock, so it is
// plainly visible. We sample the pixels of a lava tile and an adjacent plain rock tile.

import { newRun, solid, sampleTile, colorDistance, SPAWN_COL, DEEPSTONE_ROW } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("color.lava");
  const col = SPAWN_COL;
  const row = DEEPSTONE_ROW;

  await newRun(api);
  await api.call("teleport", col, row);
  await api.call("setTile", col + 2, row, { kind: "lava" });
  await solid(api, col + 3, row);
  await api.wait(120);

  const lava = await sampleTile(api, col + 2, row);
  const rock = await sampleTile(api, col + 3, row);
  check.expectGt("lava is plainly distinct from the rock", colorDistance(lava, rock), 60);

  await api.screenshot("lava");
  return check.verdict();
}
