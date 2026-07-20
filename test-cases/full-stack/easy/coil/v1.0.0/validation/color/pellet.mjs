// Automated validation for the Color sub-item `pellet`.
//
// The pellet is drawn in a distinct, visible color. The check samples the pixels the
// build actually RENDERS at the pellet cell, a snake body cell, and an empty board
// patch. The pellet must stand clearly apart from the board background (so it is
// visible) and from the snake (so it stands out to eat). The exact hue is the model's
// own; only the distinctness is scored.

import {
  poseColorScene,
  sampleCell,
  colorDistance,
  SCENE_CELLS,
  VISIBLE_MIN,
  DISTINCT_MIN,
} from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("color.pellet");

  await poseColorScene(api);
  const pellet = await sampleCell(api, SCENE_CELLS.pellet.col, SCENE_CELLS.pellet.row);
  const body = await sampleCell(api, SCENE_CELLS.body.col, SCENE_CELLS.body.row);
  const bg = await sampleCell(api, SCENE_CELLS.background.col, SCENE_CELLS.background.row);

  check.expectGt("the pellet is a visible color, distinct from the board", colorDistance(pellet, bg), VISIBLE_MIN);
  check.expectGt("the pellet is distinct from the snake", colorDistance(pellet, body), DISTINCT_MIN);

  await api.screenshot("scene");
  return check.verdict();
}
