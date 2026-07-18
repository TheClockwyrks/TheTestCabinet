// Automated validation for the Color sub-item `right-paddle`: the right (player two /
// AI) paddle is drawn in a distinct, visible color.
//
// The check samples the pixels the build actually RENDERS at the right paddle's
// center, the left paddle's center, and an empty patch of field (see
// validation/_helpers.mjs — sampling reads the canvas, not a value the game
// reports). The right paddle's color must stand clearly apart from the field
// background (so it is visible) and from the left paddle (so the two players are
// told apart). The exact hue is the model's own; only the distinctness is scored.

import {
  COLOR_POINTS,
  colorDistance,
  poseColorScene,
  sampleColor,
} from "../_helpers.mjs";

const VISIBLE_MIN = 50; // clearly different from the field background
const DISTINCT_MIN = 45; // clearly different from the other player's paddle

export default async function drive(api, ttc) {
  const check = ttc.checkOne("color.right-paddle");

  await poseColorScene(api);
  const left = await sampleColor(
    api,
    COLOR_POINTS.leftPaddle.x,
    COLOR_POINTS.leftPaddle.y,
  );
  const right = await sampleColor(
    api,
    COLOR_POINTS.rightPaddle.x,
    COLOR_POINTS.rightPaddle.y,
  );
  const bg = await sampleColor(
    api,
    COLOR_POINTS.background.x,
    COLOR_POINTS.background.y,
  );

  check.expectGt(
    "the right paddle is drawn in a visible color, distinct from the field background",
    colorDistance(right, bg),
    VISIBLE_MIN,
  );
  check.expectGt(
    "the right paddle's color is distinct from the left paddle's (the players are told apart)",
    colorDistance(right, left),
    DISTINCT_MIN,
  );

  await api.screenshot("scene");

  return check.verdict();
}
