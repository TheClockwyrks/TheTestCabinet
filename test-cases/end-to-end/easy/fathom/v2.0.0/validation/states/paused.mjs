// states.paused: a live dive can be paused.
//
// Entering live play is instant (`arrange`); the pause keypress and the settle the
// capture needs are `act`, so the clip shows the menu actually opening over the dive.
import { startPlaying } from "../_helpers.mjs";

export default function item() {
  let screen;

  return {
    id: "states.paused",

    async arrange(api) {
      await startPlaying(api);
    },

    async act(api) {
      await api.call("press", "Escape");
      await api.settle(150); // a REAL pause (the old wait(150)) so the pause menu is painted
      screen = (await api.snapshot()).screen;
      await api.screenshot("paused");
    },

    async assert(api, check) {
      check.expectEq("a live dive pauses", screen, "paused");
    },
  };
}
