// Automated validation for the Color sub-item `ship-band`.
//
// The ship renders in its current band's color, and that color changes when it
// flips. The ship is posed on each band and the pixels it PAINTS at the ship's
// position sampled; the two renders must be visibly distinct (and each distinct
// from the field), so the ship reads its band by color.

import { startStageClean, sampleVivid, sampleSaturated, colorDistance, SHIP_Y } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("color.ship-band");

  await startStageClean(api, 1);
  await api.call("setShipX", 640);

  // Read the ship's BAND by its most-saturated painted pixel: the fighter keeps a
  // neutral white hull (the brightest pixel, unchanging across bands), so its band
  // is told by the tinted accents/glyph, which is what a player reads too.
  await api.call("setShipBand", "cyan");
  await api.wait(100);
  const cyanShip = await sampleSaturated(api, 616, SHIP_Y - 22, 664, SHIP_Y + 22);

  await api.call("setShipBand", "magenta");
  await api.wait(100);
  const magentaShip = await sampleSaturated(api, 616, SHIP_Y - 22, 664, SHIP_Y + 22);

  const bg = await sampleVivid(api, 600, 440, 680, 500);
  check.expectGt("the cyan-band ship is drawn in a visible color", colorDistance(cyanShip, bg), 50);
  check.expectGt("the ship's color changes when it flips", colorDistance(cyanShip, magentaShip), 40);

  await api.screenshot("ship");
  return check.verdict();
}
