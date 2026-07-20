// Color: the worker renders in a distinct, visible hi-vis color, clearly different from the
// ground it stands on. The rendered pixels at the worker's body and at an empty ground patch
// are sampled from the actual canvas (not any reported value).

import {
  setTile,
  startFresh,
  sampleColor,
  colorDistance,
  tileCenterX,
  tileCenterY,
} from "../_helpers.mjs";

const DISTINCT_MIN = 40;
const WX = tileCenterX(10);
const WY = tileCenterY(12);

export default function item() {
  // The rendered color of the worker's body and of bare ground.
  let worker;
  let ground;

  return {
    id: "color.worker",

    // Pose the worker on an open tile with clear ground a few columns over.
    async arrange(api) {
      await startFresh(api, 1);
      await setTile(api, 10, 12);
    },

    // The sampling reads PAINTED pixels, so it runs here behind `api.settle` — a real
    // pause in both passes, and the only thing that guarantees a frame has landed since
    // the worker was posed.
    async act(api) {
      await api.settle(120);

      worker = await sampleColor(api, WX, WY - 20); // the worker's body
      ground = await sampleColor(api, WX + 120, WY); // an empty ground tile three columns over

      await api.screenshot("scene");
    },

    async assert(api, check) {
      check.expectGt(
        "the worker is drawn in a color distinct from the ground",
        colorDistance(worker, ground),
        DISTINCT_MIN,
      );
    },
  };
}
