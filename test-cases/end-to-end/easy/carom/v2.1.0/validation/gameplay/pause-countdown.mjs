// Automated validation for the Gameplay sub-item `pause-during-countdown`.
//
// Pausing is allowed at any time during gameplay, including during the pre-serve
// countdown (not only once the ball is in flight). A match is started from the title
// with injected keys — which opens on the countdown — and a pause key is pressed
// there; the resulting screen is read back. See validation/_helpers.mjs.

import { startWithKeys } from "../_helpers.mjs";

export default function item() {
  let opened;
  let paused;

  return {
    id: "gameplay.pause-during-countdown",

    // Navigate the title menu with injected keys, which leaves the match on its
    // pre-serve countdown — the moment this item pauses at.
    async arrange(api) {
      await startWithKeys(api, "solo");
    },

    // The press happens with no time run first, so the countdown is still on screen —
    // the whole point of the item is that a pause is accepted THERE, not only once the
    // ball is in flight. Both screens are read here and asserted afterwards; the hold
    // that follows lets the pause menu paint for the capture.
    async act(api) {
      opened = (await api.snapshot()).screen;

      await api.call("press", "Escape");
      paused = (await api.snapshot()).screen;

      await api.advance(24); // 24 ticks = the old 200ms redraw before the capture
      await api.screenshot("paused");
    },

    async assert(api, check) {
      check.expectEq(
        "a started match opens on the pre-serve countdown",
        opened,
        "countdown",
      );
      check.expectEq(
        "pressing Esc during the countdown pauses the game",
        paused,
        "paused",
      );
    },
  };
}
