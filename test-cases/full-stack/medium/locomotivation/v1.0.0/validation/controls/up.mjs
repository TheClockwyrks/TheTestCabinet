// Controls: W / Up arrow move the worker up (y decreases) and face it up.
// Injected keys drive the real movement code; the step reads the result back.

import { directionCheck, directionClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.up");
  await directionCheck(api, check, { keys: ["KeyW", "ArrowUp"], axis: "y", sign: -1, facing: "up" });
  await directionClip(api, { code: "ArrowUp" });
  return check.verdict();
}
