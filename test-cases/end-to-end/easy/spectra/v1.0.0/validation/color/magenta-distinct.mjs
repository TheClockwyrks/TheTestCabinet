// Automated validation for the Color sub-item `magenta-distinct`.
//
// A magenta-band drone renders in a distinct, visible color, clearly different from
// a cyan drone and from the field background. The pixels the build actually PAINTS
// are sampled, so a build cannot pass by claiming a color it does not draw.

import {
  startStageClean,
  spawnDrone,
  sampleVivid,
  colorDistance,
} from "../_helpers.mjs";

const VISIBLE_MIN = 60;
const DISTINCT_MIN = 40;

export default function item() {
  // The three sampled colors, read from the painted canvas in `act`.
  let cyan;
  let magenta;
  let bg;

  return {
    id: "color.magenta-distinct",

    // One drone of each band side by side, on an otherwise empty field.
    async arrange(api) {
      await startStageClean(api, 1);
      await api.call("setShipX", 640);
      await spawnDrone(api, {
        kind: "shard",
        band: "cyan",
        x: 400,
        y: 300,
        phase: "formation",
      });
      await spawnDrone(api, {
        kind: "shard",
        band: "magenta",
        x: 800,
        y: 300,
        phase: "formation",
      });
    },

    // The scene is static, so the only thing `act` needs is a painted frame to read.
    // `settle` is a real pause in both passes and is the only way to get one in the
    // validate pass, where advancing time is instant and paints nothing.
    async act(api) {
      await api.settle(120);
      cyan = await sampleVivid(api, 380, 280, 420, 320);
      magenta = await sampleVivid(api, 780, 280, 820, 320);
      bg = await sampleVivid(api, 600, 440, 680, 500);
      await api.screenshot("scene");
    },

    async assert(api, check) {
      check.expectGt(
        "a magenta drone is drawn in a visible color vs the background",
        colorDistance(magenta, bg),
        VISIBLE_MIN,
      );
      check.expectGt(
        "a magenta drone is distinct from a cyan drone",
        colorDistance(magenta, cyan),
        DISTINCT_MIN,
      );
    },
  };
}
