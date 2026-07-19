// Automated validation for controls.pause-escape: pressing Escape during play pauses
// the game. Injected input flows through the real key handling.

import { pauseControlCheck } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.pause-escape");
  await pauseControlCheck(api, check, "Escape");
  return check.verdict();
}
