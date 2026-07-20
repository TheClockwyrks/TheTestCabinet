// Automated validation for the Multi Player Controls sub-item `escape`.
//
// During a versus match, pressing Esc must pause the game (screen -> "paused"). The
// match is started from the title with injected keys, played briefly, then the pause
// key is pressed and the resulting screen is read back. See validation/_helpers.mjs.

import { pauseCheck } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls-versus.escape");
  await pauseCheck(api, check, { mode: "versus", code: "Escape" });
  return check.verdict();
}
