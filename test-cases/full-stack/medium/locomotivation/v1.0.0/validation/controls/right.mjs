// Controls: D / Right arrow move the worker right (x increases) and face it right.

import { directionCheck, directionClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.right");
  await directionCheck(api, check, { keys: ["KeyD", "ArrowRight"], axis: "x", sign: 1, facing: "right" });
  await directionClip(api, { code: "ArrowRight" });
  return check.verdict();
}
