// Controls: S / Down arrow move the worker down (y increases) and face it down.

import { directionCheck, directionClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.down");
  await directionCheck(api, check, { keys: ["KeyS", "ArrowDown"], axis: "y", sign: 1, facing: "down" });
  await directionClip(api, { code: "ArrowDown" });
  return check.verdict();
}
