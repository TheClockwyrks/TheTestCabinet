// Automated validation for the Color sub-item `suit-distinction`.
//
// Red-suit and black-suit cards render in clearly distinct colors. This reads the
// pixels the build actually PAINTS (api.pixel) at the large central pip of a face-up
// red card and a face-up black card, and confirms the two colors stand clearly
// apart and that the red card reads redder. The exact palette is the model's own;
// only the distinction is scored.

import { card, cardCenter, colorDistance, COLS_X, pose, sampleColor, TABLEAU_Y } from "../_helpers.mjs";

const DISTINCT = 55; // clearly different red vs black card colors

export default async function drive(api, ttc) {
  const check = ttc.checkOne("color.suit-distinction");

  // A red card (hearts) and a black card (spades) side by side, face-up.
  await pose(api, { tableau: [[card("hearts", 7, true)], [card("spades", 7, true)]] }, 1);
  await api.wait(120);

  const redCenter = cardCenter(COLS_X[0], TABLEAU_Y);
  const blackCenter = cardCenter(COLS_X[1], TABLEAU_Y);
  // The large central pip sits a touch below the card center.
  const red = await sampleColor(api, redCenter.x, redCenter.y + 4);
  const black = await sampleColor(api, blackCenter.x, blackCenter.y + 4);

  check.expectGt("the red-suit and black-suit cards render in distinct colors", colorDistance(red, black), DISTINCT);
  check.expectGt("the red suit reads clearly redder than the black suit", red.r - black.r, 30);

  await api.screenshot("suits");
  return check.verdict();
}
