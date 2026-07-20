// Automated validation for the Color sub-item `obstacle`: the mid-field obstacles are
// drawn in a distinct, visible color.
//
// The check samples the pixels the build actually RENDERS at obstacle A's center,
// both paddle centers, and an empty patch of field (see validation/_helpers.mjs —
// sampling reads the canvas, not a value the game reports). The obstacle's color must
// stand clearly apart from the field background (so it is visible) and from both
// paddles (so obstacles are not mistaken for a paddle). The exact hue is the model's
// own; only the distinctness is scored.

import {
  COLOR_POINTS,
  colorDistance,
  poseColorScene,
  sampleColor,
} from "../_helpers.mjs";

const VISIBLE_MIN = 50; // clearly different from the field background
const DISTINCT_MIN = 45; // clearly different from either paddle

export default async function drive(api, ttc) {
  const check = ttc.checkOne("color.obstacle");

  await poseColorScene(api);
  const obstacle = await sampleColor(
    api,
    COLOR_POINTS.obstacle.x,
    COLOR_POINTS.obstacle.y,
  );
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
    "the obstacle is drawn in a visible color, distinct from the field background",
    colorDistance(obstacle, bg),
    VISIBLE_MIN,
  );
  check.expectGt(
    "the obstacle's color is distinct from the left paddle's",
    colorDistance(obstacle, left),
    DISTINCT_MIN,
  );
  check.expectGt(
    "the obstacle's color is distinct from the right paddle's",
    colorDistance(obstacle, right),
    DISTINCT_MIN,
  );

  await api.screenshot("scene");

  return check.verdict();
}
