// Automated validation for the Color sub-item `left-paddle`: the left (player one)
// paddle is drawn in a distinct, visible color.
//
// The check samples the pixels the build actually RENDERS at the left paddle's
// center, the right paddle's center, and an empty patch of field (see
// validation/_helpers.mjs — sampling reads the canvas, not a value the game
// reports). The left paddle's color must stand clearly apart from the field
// background (so it is visible) and from the right paddle (so the two players are
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
  const check = ttc.checkOne("color.left-paddle");

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
    "the left paddle is drawn in a visible color, distinct from the field background",
    colorDistance(left, bg),
    VISIBLE_MIN,
  );
  check.expectGt(
    "the left paddle's color is distinct from the right paddle's (the players are told apart)",
    colorDistance(left, right),
    DISTINCT_MIN,
  );

  await api.screenshot("scene");

  return check.verdict();
}
