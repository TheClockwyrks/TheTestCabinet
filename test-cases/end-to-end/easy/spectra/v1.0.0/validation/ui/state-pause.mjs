// Automated validation for the UI sub-item `state-pause`: the pause menu is
// reachable, and captured for the reviewer.
//
// A live wave is entered (its swarm kept behind the menu) and a pause key pressed
// with injected input; the resulting paused screen is read back and captured.

import { startClean } from "../_helpers.mjs";

export default function item() {
  // The screen the pause key produced.
  let screen;

  return {
    id: "ui.state-pause",

    // A live stage-1 wave with its swarm kept, so the pause menu is captured over an
    // actual field — which is how a player meets it, and what lets a reviewer judge
    // whether the menu reads clearly against live content.
    async arrange(api) {
      await startClean(api, { clear: false });
    },

    async act(api) {
      await api.advance(72); // 72 ticks = the old 0.6 s: let some of the wave fly in behind the pause
      await api.call("press", "Escape");

      // A real pause so the menu has been painted before it is read and captured.
      await api.settle(120);
      screen = (await api.snapshot()).screen;
      await api.screenshot("pause");
    },

    async assert(api, check) {
      check.expectEq("a pause key pauses the wave", screen, "paused");
    },
  };
}
