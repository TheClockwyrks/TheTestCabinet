// Automated validation for color.bands.
//
// The four band rocks each render in a distinct, visible color, so the band a player is in reads from
// the world. We sample a plain rock tile in each band (from the pixels the build actually paints) and
// confirm the four colors span a visible range, none are identical, and each stands apart from the
// dark tunnel behind the miner.

import { newRun, solid, sampleTile, colorDistance, SPAWN_COL, TOPSOIL_ROW, ROCKBED_ROW, DEEPSTONE_ROW, CORESHELL_ROW } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("color.bands");
  const col = SPAWN_COL;
  const rows = [TOPSOIL_ROW, ROCKBED_ROW, DEEPSTONE_ROW, CORESHELL_ROW];

  await newRun(api);
  const colors = [];
  let bg = null;
  for (const row of rows) {
    await api.call("teleport", col, row);
    await solid(api, col + 2, row); // a guaranteed plain rock tile to sample
    await api.wait(120);
    colors.push(await sampleTile(api, col + 2, row));
    if (bg === null) {
      bg = await sampleTile(api, col, row); // the carved tunnel the miner stands in (dark)
      await api.screenshot("bands");
    }
  }

  let maxPair = 0;
  let minPair = Infinity;
  for (let i = 0; i < colors.length; i += 1) {
    check.expectGt(`band ${i} stands apart from the dark tunnel`, colorDistance(colors[i], bg), 25);
    for (let j = i + 1; j < colors.length; j += 1) {
      const d = colorDistance(colors[i], colors[j]);
      if (d > maxPair) maxPair = d;
      if (d < minPair) minPair = d;
    }
  }
  check.expectGt("the four band colors span a visible range", maxPair, 30);
  check.expectGt("no two bands render the same color", minPair, 12);

  return check.verdict();
}
