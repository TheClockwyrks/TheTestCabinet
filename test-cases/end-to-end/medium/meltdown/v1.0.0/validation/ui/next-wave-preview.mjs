// Automated validation for the UI sub-item `next-wave-preview`.
//
// During a build phase the inspector previews the makeup of the coming wave
// (specs/playfield.md). We read the wave preview in the opening build phase and confirm
// it lists the coming wave's surge types, capturing it for the reviewer.

import { newGame } from "../_helpers.mjs";

export default function item() {
  let s;

  return {
    id: "ui.next-wave-preview",

    async arrange(api) {
      s = await newGame(api, "containment", "medium");
    },

    // Let a frame land so the captured still shows the inspector's preview panel.
    async act(api) {
      await api.settle(80);
      await api.screenshot("preview");
    },

    async assert(api, check) {
      check.expectOk(
        "a build phase reports a wave preview",
        Array.isArray(s.wavePreview),
      );
      check.expectGt(
        "the preview lists at least one coming surge type",
        s.wavePreview ? s.wavePreview.length : 0,
        0,
      );
    },
  };
}
