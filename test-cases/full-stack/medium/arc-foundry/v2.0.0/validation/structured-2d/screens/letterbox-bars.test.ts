// screens/letterbox-bars — the bars around the fitted stage carry the stage's own
// background colour.
//
// THE REQUIREMENT. `specs/overview.md`: "the letterbox bars around the stage carry
// the stage's background color." That is a claim about what the surface OUTSIDE the
// logical space is cleared to, and it is separate from whether the stage was fitted
// into that surface correctly — a build can letterbox perfectly and clear the
// margins to black, or to nothing at all. The fit itself is the `structured-2d` engine's
// under this project, so nothing here reads it.
//
// HOW IT IS DECIDED. On a window wider than the stage, the middle of each bar is
// sampled in DEVICE coordinates — the bars are outside the logical space, so there
// is no logical point that lands on one — and held against the nearest of several
// sampled patches of the stage's own background.
//
// THE WINDOW IS A FRESH ENGINE. A device pixel ratio belongs to the surface the
// engine was built over, so `createHarness` builds one engine per shape and the
// build meets it as a fresh game, which is also the state the requirement names.

import { afterEach, it } from "vitest";
import { type Point, STAGE_H, STAGE_W } from "../constants";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  type Harness,
  sampleColor,
} from "../harness";
import { SAMPLE_SPREAD } from "./reading";

/**
 * Patches of the stage a letterbox bar is held against.
 *
 * Near the stage's own corners and edge midpoints, where `specs/ui.md` leaves the
 * title screen at its plainest. The bar is compared against the NEAREST of them
 * rather than against any one, because the look is the build's and a screen shaded
 * toward its edges has no single background colour, while every plain patch shows
 * the colour the stage was cleared to through that shading.
 */
const GROUND_POINTS: readonly Point[] = [
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
  view: { offsetX: number; offsetY: number },
  store: { width: number; height: number },
): Point[] {
  const points: Point[] = [];
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

afterEach(() => {
  for (const h of harnesses) h.dispose();
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
  h.debug.reset();
  await h.advance(1);
  captureStill(h, "bars");

  const view = h.viewport();
  const bars = barPoints(view, {
    width: h.canvas.width,
    height: h.canvas.height,
  });
  assertGreaterThan(
    bars.length,
    0,
    "a window wider than the stage to letterbox it, so there are bars to read " +
      "(specs/overview.md)",
  );

  const ground = GROUND_POINTS.map((point) =>
    sampleColor(h, point.x, point.y, SAMPLE_SPREAD),
  );
  for (const bar of bars) {
    const read = h.ctx.getImageData(bar.x, bar.y, 1, 1).data;
    const sampled = { r: read[0]!, g: read[1]!, b: read[2]! };
    assertLessThanOrEqual(
      Math.min(...ground.map((patch) => colorDistance(sampled, patch))),
      BAR_MATCH_MAX,
      `the colour of the letterbox bar at device (${bar.x}, ${bar.y}), which ` +
        "carries the stage's background colour (specs/overview.md)",
    );
  }
});
