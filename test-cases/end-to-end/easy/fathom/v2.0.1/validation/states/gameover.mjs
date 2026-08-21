// states.gameover: losing the last life reaches the game-over screen.
//
// Spending every life needs the sim to run a collision each time (and `beginPlay` between
// them, which is a control op and so is legal inside act), so the loop is `act`; the
// capture at the end is the game-over screen.
import {
  actLoseEveryLife,
  denAllExcept,
  startPlaying,
} from "../_helpers.mjs";

export default function item() {
  let screen;

  return {
    id: "states.gameover",

    async arrange(api) {
      await startPlaying(api);
      await denAllExcept(api, ["gloamfin"]);
    },

    async act(api) {
      screen = (await actLoseEveryLife(api)).screen;
      await api.settle(150); // a REAL pause (the old wait(150)) so the still is painted
      await api.screenshot("gameover");
    },

    async assert(api, check) {
      check.expectEq(
        "losing the last life reaches game over",
        screen,
        "gameover",
      );
    },
  };
}
