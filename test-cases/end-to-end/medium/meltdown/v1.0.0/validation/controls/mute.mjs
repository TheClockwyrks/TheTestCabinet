// Automated validation for the Controls sub-item `mute`.
//
// The mute hotkey toggles sound (specs/controls.md, specs/ui.md). From a running match
// with mute off, a single press flips it on.
//
// Tested in a match, not on the title screen. The mute toggle the spec requires is a
// HUD control in the build panel (specs/ui.md), which exists while a match is running,
// and injected input triggers "any one-shot action the key triggers ON THE CURRENT
// SCREEN" (specs/instrumentation.md) — so a build that scopes its accelerators to the
// screens that own them is conformant, and pressing mute at the title proves nothing
// either way. Note the key itself is the build's own choice ("a key (for example `M`)",
// with the chosen keys listed in the How to play screen and the produced README.md);
// `KeyM` is the spec's example and the code `specs/instrumentation.md` names, so it is
// what this drives.

import { newGame, press } from "../_helpers.mjs";

export default function item() {
  let before;
  let after;

  return {
    id: "controls.mute",

    // A running match, where mute starts off and the HUD's mute control is on screen.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
    },

    // Read the starting state, press M, read it flip. The settle gives the mute
    // indicator a frame to repaint before the still is captured.
    async act(api) {
      before = (await api.snapshot()).muted;
      await press(api, "KeyM");
      after = (await api.snapshot()).muted;
      await api.settle(120);
      await api.screenshot("mute");
    },

    async assert(api, check) {
      check.expectEq("mute starts off", before, false);
      check.expectEq("M toggles mute on", after, true);
    },
  };
}
