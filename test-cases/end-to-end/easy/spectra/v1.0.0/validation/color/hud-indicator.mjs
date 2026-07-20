// Automated validation for the Color sub-item `hud-indicator`.
//
// The bottom polarity indicator renders in the ship's current band color and
// changes when the ship flips. The indicator strip (bottom-right of the field) is
// sampled on each band — the brightest painted pixel in the strip is the indicator's
// own color — and the two renders must be visibly distinct.

import { startStageClean, sampleVivid, colorDistance } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("color.hud-indicator");

  await startStageClean(api, 1);
  await api.call("setShipX", 640);

  // The polarity swatch/label live in the bottom-right HUD strip (right of the
  // centered resonance meter). Sample a strip wide enough to catch it on either band.
  await api.call("setShipBand", "cyan");
  await api.wait(100);
  const cyanHud = await sampleVivid(api, 1075, 676, 1245, 700, 18, 5);

  await api.call("setShipBand", "magenta");
  await api.wait(100);
  const magentaHud = await sampleVivid(api, 1075, 676, 1245, 700, 18, 5);

  check.expectGt("the indicator reads a visible band color", cyanHud.r + cyanHud.g + cyanHud.b, 120);
  check.expectGt("the indicator's color changes when the ship flips", colorDistance(cyanHud, magentaHud), 40);

  await api.screenshot("indicator");
  return check.verdict();
}
