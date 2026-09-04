// Carom — rendering/window-fit-bars: the letterbox bars show the field's
// background.
//
// specs/overview.md: the letterbox bars around the field are the field's
// background color. `window-fit` reads that the field was fitted and drawn into
// the map the runtime reported; this reads what is OUTSIDE it, which costs the
// look alone and nothing of how the game plays.
//
// TWO READINGS, because under an engine both are available. The bars are outside
// the logical space, so a conformant build never touches them and they hold
// exactly what the engine cleared the canvas to — the build's own exported
// `BACKGROUND`, rasterized by `clearColor` — which is the tight reading. The
// second is the one every project shares: the bar against the NEAREST of the
// empty field patches, because the look is the build's and a field shaded toward
// its edges has no single colour, but every empty patch shows the colour it was
// cleared to through that shading.
//
// ONE OFF-ASPECT WINDOW. A bar exists only where the surface is not the field's
// shape, so the reading is taken on the one window that has bars to read: 1600
// wide against a 1280-wide field, an 80 CSS pixel bar on each side.
//
// The scene is the still, isolated one `arrangeColorScene` poses, so what the
// field patches read is the field's ground rather than a body standing on it.

import { afterEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import {
  FIELD_POINTS,
  arrangeColorScene,
  captureStill,
  clearColor,
  colorDistance,
  createHarness,
  sampleColor,
  type Harness,
} from "../harness";

/**
 * How far a bar pixel may sit from the rasterized `BACKGROUND`, in RGB distance.
 *
 * Rounding room for the rasterization of a CSS color string, not a style
 * allowance: the bar holds exactly what the engine cleared to.
 */
const CLEAR_MAX = 3;

/**
 * How far a bar pixel may sit from the nearest sampled empty-field patch, in RGB
 * distance: the review item's 25/441.
 *
 * The bar holds the raw clear colour, while an empty patch of field shows that
 * colour through whatever the build legitimately lays over its field — a
 * vignette, a gradient, a faint texture — because the look is the build's.
 * Builds inspected and judged correct have measured up to about 9 here, so a
 * bound of 8 failed fine builds; 25 gives that drift close to a three-fold
 * margin while staying at half of the scale's own line for a body clearly apart
 * from the field, so a bar carrying anything the game visibly drew still fails.
 */
const SHADE_MAX = 25;

/** The device columns the two bars are sampled in, level with the field's middle. */
const BAR_COLUMNS = [40, 1560];
const BAR_ROW = 360;

let h: Harness;

afterEach(() => {
  h?.dispose();
});

it("paints the letterbox bars the field's own background", async () => {
  // 1600 wide against a 1280-wide field: an 80 CSS pixel bar on each side.
  h = await createHarness({ cssWidth: 1600, cssHeight: 720, dpr: 1 });
  await arrangeColorScene(h);
  captureStill(h, "bars");

  const background = clearColor();
  const patches = FIELD_POINTS.map((point) => sampleColor(h, point.x, point.y));
  for (const deviceX of BAR_COLUMNS) {
    const bar = h.ctx.getImageData(deviceX, BAR_ROW, 1, 1).data;
    const barColor = { r: bar[0], g: bar[1], b: bar[2] };
    assertLessThanOrEqual(colorDistance(barColor, background), CLEAR_MAX);
    const nearest = Math.min(
      ...patches.map((patch) => colorDistance(barColor, patch)),
    );
    assertLessThanOrEqual(nearest, SHADE_MAX);
  }
});
