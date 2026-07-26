// Automated validation for audio.mute-toggle — the mute control toggles the audio mute state on and
// off. We read the muted flag before and after pressing the mute key.

import { press } from "../_helpers.mjs";

export default function item() {
  let start;
  let on;
  let off;

  return {
    id: "audio.mute-toggle",

    // A fresh build on its opening screen, before anything has touched the mute state.
    async arrange(api) {
      await api.reset({ seed: 1 });
      start = (await api.snapshot()).muted;
    },

    // The presses ARE the behavior under test, so they happen here and the clip shows the control
    // being worked: mute on, then mute off again.
    async act(api) {
      await press(api, "KeyM");
      on = (await api.snapshot()).muted;
      // A real paint pause so the muted indicator is on the canvas before the capture (this
      // replaces the old `api.wait(150)`; it moves no game time).
      await api.settle(150);
      await api.screenshot("muted");

      await press(api, "KeyM");
      off = (await api.snapshot()).muted;
    },

    async assert(api, check) {
      check.expectEq("mute starts off", start, false);
      check.expectEq("the mute key turns mute on", on, true);
      check.expectEq("the mute key turns mute off again", off, false);
    },
  };
}
