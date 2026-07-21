// Automated validation for the Color sub-item `suit-distinction`.
//
// Red-suit and black-suit cards render in clearly distinct colors. This reads the
// pixels the build actually PAINTS (api.pixel) at the large central pip of a face-up
// red card and a face-up black card, and confirms the two colors stand clearly
// apart and that the red card reads redder. The exact palette is the model's own;
// only the distinction is scored.
//
// The pause before sampling is `api.settle`, not `api.advance`: a pixel read needs a
// PAINTED frame, and stepping the simulation produces none. `settle` is real
// milliseconds in both passes, so the 120 ms carries over unconverted.

import {
  card,
  cardCenter,
  colorDistance,
  COLS_X,
  pose,
  sampleColor,
  TABLEAU_Y,
} from "../_helpers.mjs";

const DISTINCT = 55; // clearly different red vs black card colors

export default function item() {
  // The two pip colors read off the rendered canvas.
  let red;
  let black;

  return {
    id: "color.suit-distinction",

    // A red card (hearts) and a black card (spades) side by side, face-up.
    async arrange(api) {
      await pose(
        api,
        {
          tableau: [[card("hearts", 7, true)], [card("spades", 7, true)]],
        },
        1,
      );
    },

    // Let the posed scene paint, then read both pips. The scene is static, so this is
    // also all the clip needs to show: the two cards side by side in their own colors.
    async act(api) {
      await api.settle(120);

      const redCenter = cardCenter(COLS_X[0], TABLEAU_Y);
      const blackCenter = cardCenter(COLS_X[1], TABLEAU_Y);
      // The large central pip sits a touch below the card center.
      red = await sampleColor(api, redCenter.x, redCenter.y + 4);
      black = await sampleColor(api, blackCenter.x, blackCenter.y + 4);

      await api.screenshot("suits");
    },

    async assert(api, check) {
      check.expectGt(
        "the red-suit and black-suit cards render in distinct colors",
        colorDistance(red, black),
        DISTINCT,
      );
      check.expectGt(
        "the red suit reads clearly redder than the black suit",
        red.r - black.r,
        30,
      );
    },
  };
}
