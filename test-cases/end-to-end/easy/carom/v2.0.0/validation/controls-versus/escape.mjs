// Automated validation for the Multi Player Controls sub-item `escape`.
//
// During a match, pressing Esc must pause the game (screen -> "paused"). The
// match is started from the title with injected keys, played briefly, then the pause
// key is pressed and the resulting screen is read back. See validation/_helpers.mjs.

import { pauseWith } from "../_helpers.mjs";

export default async function drive(api) {
  const screen = await pauseWith(api, "versus", "Escape");
  const pass = screen === "paused";
  return {
    verdicts: { "controls-versus.escape": pass },
    notes: { "controls-versus.escape": `after Esc in play: screen=${screen} (expected paused)` },
  };
}
