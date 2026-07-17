// Automated validation for the Multi Player Controls sub-item `p`.
//
// During a match, pressing P must pause the game (screen -> "paused"). The
// match is started from the title with injected keys, played briefly, then the pause
// key is pressed and the resulting screen is read back. See validation/_helpers.mjs.

import { pauseWith } from "../_helpers.mjs";

export default async function drive(api) {
  const screen = await pauseWith(api, "versus", "KeyP");
  const pass = screen === "paused";
  return {
    verdicts: { "controls-versus.p": pass },
    notes: { "controls-versus.p": `after P in play: screen=${screen} (expected paused)` },
  };
}
