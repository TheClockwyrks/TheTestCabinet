// Automated validation for the Single Player Controls sub-item `p`.
//
// During a match, pressing P must pause the game (screen -> "paused"). The
// match is started from the title with injected keys, played briefly, then the pause
// key is pressed and the resulting screen is read back.
//
// The menu navigation is instant, so it poses the match in `arrange`; the moment of
// visible play, the press, and the hold on the pause menu all consume time, so they
// are `act` — which is exactly what the recorded clip shows. See
// validation/_helpers.mjs.

import { arrangePause, actPause, assertPause } from "../_helpers.mjs";

export default function item() {
  // The screen `act` read after the press, checked by `assert`.
  let screen;

  return {
    id: "controls-solo.p",

    async arrange(api) {
      await arrangePause(api, "solo");
    },

    async act(api) {
      screen = await actPause(api, "KeyP");
    },

    async assert(api, check) {
      assertPause(check, screen, { code: "KeyP" });
    },
  };
}
