// Automated validation for the Single Player Controls sub-item `p`.
//
// During a match, pressing P must pause the game (screen -> "paused"). The
// match is started from the title with injected keys, played briefly, then the pause
// key is pressed and the resulting screen is read back. See validation/_helpers.mjs.

import { pauseWith } from "../_helpers.mjs";

export default async function drive(api) {
  const screen = await pauseWith(api, "solo", "KeyP");
  const pass = screen === "paused";
  return {
    verdicts: { "controls-solo.p": pass },
    notes: { "controls-solo.p": `after P in play: screen=${screen} (expected paused)` },
  };
}
