// rendering/window-fit-bars — the letterbox bars hold nothing the game drew.
//
// `specs/overview.md` puts the whole field inside the surface, letterboxed and
// centered, so everything the game draws lands inside the fitted field and the
// bars either side of it hold the ground the surface was cleared to.
// `window-fit` reads that the field was fitted and drawn into the map the fit
// reports; this reads what is OUTSIDE it, which costs the look alone and nothing
// of how the game plays.
//
// WHAT IS READ IS PRESENCE, NOT COLOUR. Which color a build clears its surface
// to is its own (specs/overview.md), and whether the bars look right beside the
// field is the reviewer's to judge. So the bars are read twice, over two poses of
// the same match that differ across the whole field — bodies at the centre, then
// the obstacle off the field and the paddles at the top of their travel — and the
// two readings must be the same ground. A build whose field spilled past its fit
// paints those columns with field content, and field content moved between the
// two poses.
//
// THE COLUMNS. The bars are outside the logical space, so they are sampled in
// device pixels directly, level with the field's middle. Two of the four are the
// columns a build that ignored the fit would land a paddle in: 56 is where the
// left paddle's own logical center sits if the field was drawn unscaled, and 1530
// is where the right paddle's lands if the field was stretched to the full
// window.
//
// ONE OFF-ASPECT WINDOW. A bar exists only where the surface is not the field's
// shape, so the reading is taken on the one window that has bars to read: 1600
// wide against a 1280-wide field, a 160 device pixel bar on each side.

import { afterEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import {
  READ_NOISE,
  arrangeBareScene,
  arrangeColorScene,
  captureStill,
  colorDistance,
  createHarness,
  type Harness,
  type Rgb,
} from "../harness";

/** The device columns the two bars are sampled in, level with the field's middle. */
const BAR_COLUMNS = [40, 56, 1530, 1560];
const BAR_ROW = 360;

let h: Harness;

afterEach(async () => {
  await h.dispose();
});

/** The bars as they stand, one reading per column of {@link BAR_COLUMNS}. */
async function readBars(harness: Harness): Promise<Rgb[]> {
  const bars: Rgb[] = [];
  for (const deviceX of BAR_COLUMNS) {
    const [r, g, b] = await harness.devicePixel(deviceX, BAR_ROW);
    bars.push({ r, g, b });
  }
  return bars;
}

it("leaves the letterbox bars untouched by what it draws", async () => {
  // 1600 wide against a 1280-wide field: a 160 device pixel bar on each side.
  h = await createHarness({ cssWidth: 1600, cssHeight: 720, dpr: 1 });

  await arrangeColorScene(h);
  await captureStill(h, "bars");
  const drawn = await readBars(h);

  await arrangeBareScene(h);
  const bare = await readBars(h);

  for (const [index, bar] of drawn.entries())
    assertLessThanOrEqual(colorDistance(bar, bare[index]), READ_NOISE);
});
