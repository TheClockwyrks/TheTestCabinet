// Automated validation for the UI sub-item `hud`: the in-wave HUD shows the score,
// stage, lives, resonance meter, and polarity indicator together.
//
// A live wave is entered and the run state posed to a full HUD (a non-zero score,
// partial resonance, several lives); the in-wave screen is confirmed and captured
// so a reviewer can read the HUD.

import { startClean } from "../_helpers.mjs";

export default function item() {
  // The screen the capture was taken on.
  let screen;

  return {
    id: "ui.hud",

    // A live stage-1 wave with its swarm kept, so the HUD is captured over an actual
    // populated field rather than an empty one.
    async arrange(api) {
      await startClean(api, { clear: false });
    },

    async act(api) {
      await api.advance(120); // 120 ticks = the old 1 s: let drones fly in so the field is populated

      // Pose every HUD field to a distinctive, non-default value, so a reviewer can
      // tell a HUD that actually reads the run state from one that renders zeros.
      await api.call("setScore", 12340);
      await api.call("setResonance", 60);
      await api.call("setLives", 3);
      screen = (await api.snapshot()).screen;

      // `settle` is a real pause in both passes, and in the validate pass it is the
      // only thing that paints a frame at all — without it the capture could show
      // the HUD before the posed values were drawn.
      await api.settle(120);
      await api.screenshot("hud");
    },

    async assert(api, check) {
      check.expectEq(
        "the HUD is captured during a live wave",
        screen,
        "inWave",
      );
    },
  };
}
