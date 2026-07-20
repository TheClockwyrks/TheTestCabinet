// Automated validation for color.cursor-distinct: the cursor renders in a color
// clearly distinct from the player-band background.
//
// The cursor is posed in the band and the rendered pixels sampled (api.pixel) at the
// cursor and at an empty patch of band; the two must stand clearly apart.

import { colorDistance, freshBoard, sampleColor } from "../_helpers.mjs";

const DISTINCT = 45;

export default function item() {
  let cursor;
  let band;

  return {
    id: "color.cursor-distinct",

    async arrange(api) {
      await freshBoard(api);
      await api.call("setCursor", 640, 688);
    },

    // The sampling lives here because it reads PAINTED pixels: `api.settle` is a
    // real pause in both passes, so a frame has landed since the scene was posed
    // (stepping the sim is instant in the validate pass and paints nothing).
    async act(api) {
      await api.settle(180);
      cursor = await sampleColor(api, 640, 688);
      band = await sampleColor(api, 200, 688); // empty band, clear of the cursor
      await api.screenshot("cursor");
    },

    async assert(api, check) {
      check.expectGt(
        "the cursor is distinct from the band background",
        colorDistance(cursor, band),
        DISTINCT,
      );
    },
  };
}
