// Automated validation for states.game-over — the Game Over screen on death is reached and captured.
// Layout is judged by eye from the capture.

import {
  newRun,
  arrangeKillByHull,
  actKillByHull,
  SPAWN_COL,
  ROCKBED_ROW,
} from "../_helpers.mjs";

export default function item() {
  let end;

  return {
    id: "states.game-over",

    // Set up the hull death; the death itself is left to the real death path in `act`.
    async arrange(api) {
      await newRun(api);
      await arrangeKillByHull(api, SPAWN_COL, ROCKBED_ROW);
    },

    // The death resolving is what reaches the screen, and the clip shows it. The settle after it
    // gives the Game Over screen a frame to paint before the capture.
    async act(api) {
      end = await actKillByHull(api);
      await api.settle(150);
      await api.screenshot("game-over");
    },

    async assert(api, check) {
      check.expectEq(
        "the Game Over screen is reached",
        end.screen,
        "game-over",
      );
    },
  };
}
