// Controls: A / Left arrow move the worker left (x decreases) and face it left.

import { directionCheck, directionClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.left");
  await directionCheck(api, check, { keys: ["KeyA", "ArrowLeft"], axis: "x", sign: -1, facing: "left" });
  await directionClip(api, { code: "ArrowLeft" });
  return check.verdict();
}
