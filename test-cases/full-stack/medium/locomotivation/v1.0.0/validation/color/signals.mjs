// Color: a crossing signal renders a clearly different color for its clear state than for
// its danger state. Level 1's signal (3,7) is sampled clear (no train), then a real train is
// posed upon its crossing so the same signal shows danger; the two rendered colors differ.

import {
  startFresh,
  sampleColor,
  colorDistance,
  tileCenterX,
  tileCenterY,
} from "../_helpers.mjs";

const DISTINCT_MIN = 40;
const HX = tileCenterX(3);
const HY = tileCenterY(7) - 24; // the signal head

export default function item() {
  // The signal head's rendered color in each state.
  let clear;
  let danger;

  return {
    id: "color.signals",

    // Enter level 1 with no train anywhere near the crossing — the "clear" precondition.
    async arrange(api) {
      await startFresh(api, 1);
    },

    // Sample the same signal head in both states. Each sample reads PAINTED pixels, so
    // each is preceded by `api.settle` — a real pause in both passes, and the only thing
    // that guarantees a frame has landed since the state changed.
    async act(api) {
      await api.settle(120);
      clear = await sampleColor(api, HX, HY);

      // Pose a commuter straddling the row-8 crossing the signal watches. No advance, so
      // it stays put and the signal is read against a stationary train.
      await api.call("spawnTrain", {
        line: 8,
        orientation: "horizontal",
        dir: "east",
        kind: "commuter",
        headPos: 200,
      });
      await api.settle(120);
      danger = await sampleColor(api, HX, HY);

      await api.screenshot("scene");
    },

    async assert(api, check) {
      check.expectGt(
        "clear and danger signal colors differ",
        colorDistance(clear, danger),
        DISTINCT_MIN,
      );
    },
  };
}
