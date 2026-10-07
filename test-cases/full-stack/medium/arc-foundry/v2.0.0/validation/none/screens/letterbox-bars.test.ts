// screens/letterbox-bars — the bars around a letterboxed stage carry the stage's
// own background colour.
//
// `specs/overview.md`: "the letterbox bars around the stage carry the stage's
// background color". A build that leaves them the page's default, or paints them
// some other colour, frames the game in a border the specification did not ask
// for — and it can do that while fitting the stage perfectly, which is why this
// is its own point and `screens/window-fit` decides the fit.
//
// HOW IT IS DECIDED. One window wider than the stage, so there are bars to read
// at all. The bar pixels are sampled in DEVICE coordinates, because they lie
// outside the logical space the stage occupies, and each is held against the
// nearest of several sampled patches of the stage's own background — the stage's
// background being the build's choice, the comparison is between the bar and the
// ground rather than against any colour named here.
//
// The fit itself is computed the way `screens/window-fit` computes it: an
// engineless build derives its own fit, so asking it where the bars are would be
// asking the build to grade itself.

import { afterEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import {
  captureStill,
  createHarness,
  type Harness,
  type Viewport,
} from "../harness";
import { colorDistance, sampleColor, toRgb } from "./reading";

/**
 * Patches of the stage a letterbox bar is held against.
 *
 * Near the stage's own corners and edge midpoints, where `specs/ui.md` leaves the
 * title screen at its plainest. The bar is compared against the NEAREST of them
 * rather than against any one, because the look is the build's and a screen shaded
 * toward its edges has no single background colour, while every plain patch shows
 * the colour the stage was cleared to through that shading.
 */
const GROUND_POINTS: readonly { x: number; y: number }[] = [
  { x: 20, y: 20 },
  { x: STAGE_W - 20, y: 20 },
  { x: 20, y: STAGE_H - 20 },
  { x: STAGE_W - 20, y: STAGE_H - 20 },
  { x: 20, y: STAGE_H / 2 },
  { x: STAGE_W - 20, y: STAGE_H / 2 },
];

/**
 * How far a letterbox bar may sit from the nearest sampled patch of the stage's
 * background, in RGB distance: `25` of the `441` a full RGB diagonal spans.
 *
 * The specification makes the bars the stage's background colour, but a bar holds
 * the raw cleared ground while a patch of stage shows that ground through whatever
 * the build legitimately lays over it — a vignette, a gradient, a faint texture —
 * because the look is the build's. `25` is the room that drift is given: wide
 * enough that a bar matching a shaded stage still reads as background, narrow
 * enough that a bar the build painted a picture of its own into does not.
 */
const BAR_MATCH_MAX = 25;

/** The middle of each letterbox bar this fit produces, in device pixels. */
function barPoints(
  view: Viewport,
  store: { width: number; height: number },
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  if (view.offsetX > 8) {
    const y = Math.round(store.height / 2);
    points.push({ x: Math.round(view.offsetX / 2), y });
    points.push({ x: Math.round(store.width - view.offsetX / 2), y });
  }
  if (view.offsetY > 8) {
    const x = Math.round(store.width / 2);
    points.push({ x, y: Math.round(view.offsetY / 2) });
    points.push({ x, y: Math.round(store.height - view.offsetY / 2) });
  }
  return points;
}

let harnesses: Harness[] = [];

afterEach(async () => {
  for (const h of harnesses) await h.dispose();
  harnesses = [];
});

async function surface(options: {
  cssWidth: number;
  cssHeight: number;
  dpr: number;
}): Promise<Harness> {
  const h = await createHarness(options);
  harnesses.push(h);
  return h;
}

it("carries the stage's background out into the letterbox bars", async () => {
  // 1600 wide against a 1280-wide stage: an 80 CSS pixel bar on each side. The
  // off-aspect surface is the one worth looking at, and the bars are not visible
  // on a surface the size of the stage.
  const h = await surface({ cssWidth: 1600, cssHeight: 720, dpr: 1 });
  await h.debug.reset();
  await h.advance(1);
  await captureStill(h, "bars");

  const store = await h.surface();
  const view = h.viewport();
  const bars = barPoints(view, store);
  assertGreaterThan(
    bars.length,
    0,
    "a window wider than the stage to letterbox it, so there are bars to read " +
      "(specs/overview.md)",
  );

  const ground = await Promise.all(
    GROUND_POINTS.map((point) => sampleColor(h, point.x, point.y)),
  );
  for (const bar of bars) {
    const sampled = toRgb(await h.devicePixel(bar.x, bar.y));
    assertLessThanOrEqual(
      Math.min(...ground.map((patch) => colorDistance(sampled, patch))),
      BAR_MATCH_MAX,
      `the colour of the letterbox bar at device (${bar.x}, ${bar.y}), which ` +
        "carries the stage's background colour (specs/overview.md)",
    );
  }
});
