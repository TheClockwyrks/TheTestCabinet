// Automated validation for controls.pause-p: pressing P during play pauses the game.
// Injected input flows through the real key handling.

import { pauseControlCheck } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.pause-p");
  await pauseControlCheck(api, check, "KeyP");
  return check.verdict();
}
