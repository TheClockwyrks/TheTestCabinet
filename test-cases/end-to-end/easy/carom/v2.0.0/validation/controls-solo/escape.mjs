// Automated validation for the Single Player Controls sub-item `escape`.
//
// During a match, pressing Esc must pause the game (screen -> "paused"). The
// match is started from the title with injected keys, played briefly, then the pause
// key is pressed and the resulting screen is read back. See validation/_helpers.mjs.

import { pauseCheck } from "../_helpers.mjs";

export default async function drive(api) {
  return {
    verdicts: {
      "controls-solo.escape": await pauseCheck(api, {
        mode: "solo",
        code: "Escape",
      }),
    },
  };
}
