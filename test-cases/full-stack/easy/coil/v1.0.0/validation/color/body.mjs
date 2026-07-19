// Automated validation for the Color sub-item `body`.
//
// The snake's body is drawn in a distinct, visible color. The check samples the pixels
// the build actually RENDERS at a straight body cell, the head cell, and an empty board
// patch. The body must stand clearly apart from the board background (so it is visible)
// and from the head (so the two are told apart). The exact hue is the model's own; only
// the distinctness is scored.

import {
  poseColorScene,
  sampleCell,
  colorDistance,
  SCENE_CELLS,
  VISIBLE_MIN,
  HEAD_BODY_MIN,
} from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("color.body");

  await poseColorScene(api);
  const body = await sampleCell(api, SCENE_CELLS.body.col, SCENE_CELLS.body.row);
  const head = await sampleCell(api, SCENE_CELLS.head.col, SCENE_CELLS.head.row);
  const bg = await sampleCell(api, SCENE_CELLS.background.col, SCENE_CELLS.background.row);

  check.expectGt("the body is a visible color, distinct from the board", colorDistance(body, bg), VISIBLE_MIN);
  check.expectGt("the body is distinct from the head", colorDistance(body, head), HEAD_BODY_MIN);

  await api.screenshot("scene");
  return check.verdict();
}
