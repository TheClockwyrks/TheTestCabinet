// State: the pause screen is reachable from a live shift (Esc).

import { startFresh } from "../_helpers.mjs";

export default function item() {
  // The screen Esc reached.
  let screen;

  return {
    id: "states.pause",

    // Enter a live shift, which is what the pause has to be posed against.
    async arrange(api) {
      await startFresh(api, 1);
    },

    // The pause itself, then a paint settle so the menu has been drawn before it is read
    // and captured.
    async act(api) {
      await api.call("press", "Escape");

      await api.settle(150);
      screen = (await api.snapshot()).screen;
      await api.screenshot("state");
    },

    async assert(api, check) {
      check.expectEq("Esc reaches the pause screen", screen, "pause");
    },
  };
}
