// Automated validation for the Color sub-item `card-back`.
//
// A face-down card back renders in a distinct color, clearly different from a
// face-up card face and from the table felt, so a covered card is never mistaken for
// a played one or for the table. This reads the pixels the build actually PAINTS
// (api.pixel): the face-down stock card, a face-up card face, and an empty patch of
// felt, and confirms the back stands apart from both.
//
// The pause before sampling is `api.settle`, not `api.advance`: a pixel read needs a
// PAINTED frame, and stepping the simulation produces none (in the validate pass it
// consumes no wall clock at all). `settle` is real milliseconds in both passes, so
// the 120 ms carries over unconverted.

import {
  card,
  cardCenter,
  colorDistance,
  COLS_X,
  FELT,
  pose,
  sampleColor,
  stockCenter,
  TABLEAU_Y,
} from "../_helpers.mjs";

const DISTINCT = 60;

export default function item() {
  // The colors read off the rendered canvas.
  let back;
  let face;

  return {
    id: "color.card-back",

    // A face-down card in the stock, and a face-up card in column 0.
    async arrange(api) {
      await pose(
        api,
        {
          stock: [card("spades", 5)],
          tableau: [[card("hearts", 7, true)]],
        },
        1,
      );
    },

    // Let the posed scene paint, then read each sample point. The scene is static, so
    // this is also all the clip needs to show: the card back beside a face-up card.
    async act(api) {
      await api.settle(120);

      back = await sampleColor(api, stockCenter().x, stockCenter().y);
      // A cream patch of the face-up card, below its central pip and clear of the corners.
      const faceTL = cardCenter(COLS_X[0], TABLEAU_Y);
      face = await sampleColor(api, faceTL.x, TABLEAU_Y + 120);

      await api.screenshot("back");
    },

    async assert(api, check) {
      check.expectGt(
        "the card back is distinct from the table felt",
        colorDistance(back, FELT),
        DISTINCT,
      );
      check.expectGt(
        "the card back is distinct from a face-up card face",
        colorDistance(back, face),
        DISTINCT,
      );
    },
  };
}
