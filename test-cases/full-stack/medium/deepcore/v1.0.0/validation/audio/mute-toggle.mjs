// Automated validation for audio.mute-toggle — the mute control toggles the audio mute state on
// and off. We read the muted flag before and after pressing the mute key.
//
// The toggle is driven IN THE MINE. It used to be driven on the title screen, which is the
// cheapest state to reach but not one the specification ties the control to: specs/controls.md
// lists "Mute: `M`, or the status-bar mute control" without saying which screens honor the key,
// and specs/ui.md puts that status-bar mute control in the in-mine HUD alongside the bag and pause
// controls. So the mine is where the spec unambiguously asks for a mute control, and the title is
// a reading it never states. A build that binds `M` in the mine — where the status bar lives and
// where the audio it mutes is playing — satisfies everything it was told, and was being failed on
// an inference instead. Driving the toggle in the mine tests the requirement itself.

import { newRun, press } from "../_helpers.mjs";

export default function item() {
  let start;
  let on;
  let off;

  return {
    id: "audio.mute-toggle",

    // A fresh expedition in the mine — the state whose status bar carries the mute control —
    // before anything has touched the mute state.
    async arrange(api) {
      await newRun(api);
      start = (await api.snapshot()).muted;
    },

    // The presses ARE the behavior under test, so they happen here and the clip shows the control
    // being worked: mute on, then mute off again.
    async act(api) {
      await press(api, "KeyM");
      on = (await api.snapshot()).muted;
      // A real paint pause so the muted indicator is on the canvas before the capture; it moves no
      // game time.
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
