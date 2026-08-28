// controls.pause-esc: Escape pauses a live dive.
//
// Entering live play is instant (`arrange`); pressing Escape and reading the screen is
// the real game responding, so it is `act`. The screen is read the instant the key is
// pressed; the stretch after is spent on the pause menu, where nothing can catch the
// forager, so nothing about the verdict can drift.
import { startPlaying } from "../_helpers.mjs";

export default function item() {
  let screen;

  return {
    id: "controls.pause-esc",

    async arrange(api) {
      await startPlaying(api);
    },

    async act(api) {
      await api.call("press", "Escape");
      screen = (await api.snapshot()).screen;
      await api.advance(84); // 84 ticks = 0.7 s held on the pause menu for the clip
    },

    async assert(api, check) {
      check.expectEq("Escape pauses a live dive", screen, "paused");
    },
  };
}
