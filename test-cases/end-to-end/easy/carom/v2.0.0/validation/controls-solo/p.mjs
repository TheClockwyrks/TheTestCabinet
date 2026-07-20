// Automated validation for the Single Player Controls sub-item `p`.
//
// During a match, pressing P must pause the game (screen -> "paused"). The
// match is started from the title with injected keys, played briefly, then the pause
// key is pressed and the resulting screen is read back. See validation/_helpers.mjs.

import { pauseCheck } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls-solo.p");
  await pauseCheck(api, check, { mode: "solo", code: "KeyP" });
  return check.verdict();
}
