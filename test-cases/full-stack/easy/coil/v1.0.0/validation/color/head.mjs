// Automated validation for the Color sub-item `head`.
//
// The snake's head is drawn in a distinct, visible color. The check samples the pixels
// the build actually RENDERS at the head cell, a straight body cell, and an empty board
// patch (see _helpers.mjs — sampling reads the canvas, not a value the game reports).
// The head must stand clearly apart from the board background (so it is visible) and
// from the body (so the head is not mistaken for a body segment). The exact hue is the
// model's own; only the distinctness is scored.

import {
  poseColorScene,
  sampleCell,
  colorDistance,
  SCENE_CELLS,
  VISIBLE_MIN,
  HEAD_BODY_MIN,
} from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("color.head");

  await poseColorScene(api);
  const head = await sampleCell(api, SCENE_CELLS.head.col, SCENE_CELLS.head.row);
  const body = await sampleCell(api, SCENE_CELLS.body.col, SCENE_CELLS.body.row);
  const bg = await sampleCell(api, SCENE_CELLS.background.col, SCENE_CELLS.background.row);

  check.expectGt("the head is a visible color, distinct from the board", colorDistance(head, bg), VISIBLE_MIN);
  check.expectGt("the head is distinct from the body", colorDistance(head, body), HEAD_BODY_MIN);

  await api.screenshot("scene");
  return check.verdict();
}
