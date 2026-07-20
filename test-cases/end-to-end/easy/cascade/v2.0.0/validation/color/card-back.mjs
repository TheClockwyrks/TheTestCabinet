// Automated validation for the Color sub-item `card-back`.
//
// A face-down card back renders in a distinct color, clearly different from a
// face-up card face and from the table felt, so a covered card is never mistaken for
// a played one or for the table. This reads the pixels the build actually PAINTS
// (api.pixel): the face-down stock card, a face-up card face, and an empty patch of
// felt, and confirms the back stands apart from both.

import { card, cardCenter, colorDistance, COLS_X, FELT, pose, sampleColor, stockCenter, TABLEAU_Y } from "../_helpers.mjs";

const DISTINCT = 60;

export default async function drive(api, ttc) {
  const check = ttc.checkOne("color.card-back");

  // A face-down card in the stock, and a face-up card in column 0.
  await pose(api, { stock: [card("spades", 5)], tableau: [[card("hearts", 7, true)]] }, 1);
  await api.wait(120);

  const back = await sampleColor(api, stockCenter().x, stockCenter().y);
  // A cream patch of the face-up card, below its central pip and clear of the corners.
  const faceTL = cardCenter(COLS_X[0], TABLEAU_Y);
  const face = await sampleColor(api, faceTL.x, TABLEAU_Y + 120);

  check.expectGt("the card back is distinct from the table felt", colorDistance(back, FELT), DISTINCT);
  check.expectGt("the card back is distinct from a face-up card face", colorDistance(back, face), DISTINCT);

  await api.screenshot("back");
  return check.verdict();
}
