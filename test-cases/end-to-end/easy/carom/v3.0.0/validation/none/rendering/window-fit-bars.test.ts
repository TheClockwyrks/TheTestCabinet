// rendering/window-fit-bars — the letterbox bars show the field's background.
//
// `specs/overview.md`: the letterbox bars around the field are the field's
// background color. `window-fit` reads that the field was fitted and drawn into
// the map the fit reports; this reads what is OUTSIDE it, which costs the look
// alone and nothing of how the game plays.
//
// The bars are outside the logical space, so they are sampled in device pixels
// directly, against the NEAREST of the empty field patches: the look is the
// build's, and a field shaded toward its edges has no single color, but every
// empty patch shows the color it was cleared to through that shading. A build
// that let the field spill into a bar, or painted the bars some other ground,
// puts something else there.
//
// ONE OFF-ASPECT WINDOW. A bar exists only where the surface is not the field's
// shape, so the reading is taken on the one window that has bars to read: 1600
// wide against a 1280-wide field, an 80 CSS pixel bar on each side.
//
// UNDER `none` THERE IS NO EXPORTED CLEAR COLOR TO COMPARE AGAINST. An
// engineless build clears its own canvas however it likes, so the only reading
// available is the bar against the field's own patches, which is the half of the
// review item every project shares.
//
// The scene is the still, isolated one `arrangeColorScene` poses, so what the
// field patches read is the field's ground rather than a body standing on it.

import { afterEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import {
  FIELD_POINTS,
  arrangeColorScene,
  captureStill,
  colorDistance,
  createHarness,
  sampleColor,
  type Harness,
} from "../harness";

/**
 * How far a letterbox bar's color may sit from the nearest sampled empty-field
 * patch, in RGB distance: the review item's 25/441.
 *
 * The specification makes the bars the field's background color, but the bar
 * holds the raw cleared ground while an empty patch of field shows that ground
 * through whatever the build legitimately lays over its field — a vignette, a
 * gradient, a faint texture — because the look is the build's. Builds inspected
 * and judged correct have measured up to about 9 here, so a rounding-only bound
 * of 8 failed fine builds; 25 gives that drift close to a three-fold margin
 * while staying at half of DISTINCT_MIN, the scale's own line for a body clearly
 * apart from the field, so a bar carrying anything the game visibly drew still
 * fails.
 */
const BAR_MATCH_MAX = 25;

/** The device columns the two bars are sampled in, level with the field's middle. */
const BAR_COLUMNS = [40, 1560];
const BAR_ROW = 360;

let h: Harness;

afterEach(async () => {
  await h.dispose();
});

it("paints the letterbox bars the field's own background", async () => {
  // 1600 wide against a 1280-wide field: an 80 CSS pixel bar on each side.
  h = await createHarness({ cssWidth: 1600, cssHeight: 720, dpr: 1 });
  await arrangeColorScene(h);
  await captureStill(h, "bars");

  const patches = await Promise.all(
    FIELD_POINTS.map((point) => sampleColor(h, point.x, point.y)),
  );
  for (const deviceX of BAR_COLUMNS) {
    const bar = await h.devicePixel(deviceX, BAR_ROW);
    const barColor = { r: bar[0], g: bar[1], b: bar[2] };
    const nearest = Math.min(
      ...patches.map((patch) => colorDistance(barColor, patch)),
    );
    assertLessThanOrEqual(nearest, BAR_MATCH_MAX);
  }
});
