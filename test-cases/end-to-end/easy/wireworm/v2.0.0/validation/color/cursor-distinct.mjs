// Automated validation for color.cursor-distinct: the cursor renders in a color
// clearly distinct from the player-band background.
//
// The cursor is posed in the band and the rendered pixels sampled (api.pixel) at the
// cursor and at an empty patch of band; the two must stand clearly apart.

import { colorDistance, freshBoard, sampleColor } from "../_helpers.mjs";

const DISTINCT = 45;

export default async function drive(api, ttc) {
  const check = ttc.checkOne("color.cursor-distinct");

  await freshBoard(api);
  await api.call("setCursor", 640, 688);
  await api.wait(180);

  const cursor = await sampleColor(api, 640, 688);
  const band = await sampleColor(api, 200, 688); // empty band, clear of the cursor

  check.expectGt("the cursor is distinct from the band background", colorDistance(cursor, band), DISTINCT);

  await api.screenshot("cursor");

  return check.verdict();
}
