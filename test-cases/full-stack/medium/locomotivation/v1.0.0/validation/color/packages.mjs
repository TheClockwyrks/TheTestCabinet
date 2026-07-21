// Color: the red, blue, green, and amber packages each render in a mutually distinct color.
// One parcel of each color is placed on the ground and its rendered pixels sampled; every
// pair must stand clearly apart.

import {
  startFresh,
  sampleColor,
  colorDistance,
  tileCenterX,
  tileCenterY,
} from "../_helpers.mjs";

const DISTINCT_MIN = 40;
const COLS = { red: 8, blue: 12, green: 16, amber: 20 };

export default function item() {
  // The sampled colors, keyed by name, read back by `assert`.
  let colors;

  return {
    id: "color.packages",

    // Lay one parcel of each color out on the same row. All control ops.
    async arrange(api) {
      await startFresh(api, 1);
      for (const [color, col] of Object.entries(COLS)) {
        await api.call("spawnGroundPackage", {
          col,
          row: 12,
          color,
          weightClass: "parcel",
          archetype: "optional",
        });
      }
    },

    // The sampling. This reads PAINTED pixels, so it has to run here (and not in
    // arrange): `api.settle` is a real pause in both passes and is the only thing that
    // guarantees a frame has landed since the parcels were posed. `advance` would not do
    // — in the validate pass it is instant and produces no frame at all.
    async act(api) {
      await api.settle(120);

      colors = {};
      for (const [name, col] of Object.entries(COLS)) {
        colors[name] = await sampleColor(
          api,
          tileCenterX(col),
          tileCenterY(12) - 9,
        ); // the parcel's face
      }

      await api.screenshot("scene");
    },

    async assert(api, check) {
      const names = Object.keys(COLS);
      for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
          check.expectGt(
            `${names[i]} and ${names[j]} packages render distinctly`,
            colorDistance(colors[names[i]], colors[names[j]]),
            DISTINCT_MIN,
          );
        }
      }
    },
  };
}
