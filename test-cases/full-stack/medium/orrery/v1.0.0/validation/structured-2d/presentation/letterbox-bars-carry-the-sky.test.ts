// presentation/letterbox-bars-carry-the-sky — the bars around the fitted stage are
// the colour the stage's own background is.
//
// THE RULE. "The letterbox bars around the stage carry the stage's background
// color" (`specs/overview.md`, Coordinate system and presentation), which is the
// colour the canvas is cleared to: under either engine `src/game.ts` "exports
// `BACKGROUND`, a CSS color string: the stage background. `src/main.ts` hands it
// to the engine as the color the canvas is cleared to each frame, so the letterbox
// bars around the stage match the sky itself." So the sky runs to the edge of the
// window rather than the stage sitting on a plate of some other colour.
//
// WHAT THE SKY IS READ AS, WITHOUT ASKING THE BUILD. `specs/ui.md` "fixes no
// palette", so the colour cannot be named here; it is read off the stage instead.
// `color.ts`'s `darkestOf` is the case's reading for the bare sky: everything the
// build draws sits ON the dark sky ("Every sprite reads on the dark sky",
// `specs/assets.md`), so the darkest of several patches is the one nothing covered.
// The patches are taken along the stage's own edges on the `title` screen, where
// "Nothing" advances (`specs/ui.md`) and the screen is at rest.
//
// WHERE THE BARS ARE READ. Every pixel reading is addressed in the stage's logical
// units and mapped through the fit `viewport.ts` computes, so a logical point
// LEFT of `0` or ABOVE `0` lands in the bar beyond that edge. Both shapes are
// read, because a build may fit one axis and not the other: a surface wider than
// `16:9`, which puts the bars left and right, and one taller, which puts them
// above and below. Two points are taken in each bar — one just beyond the stage
// and one far out in the bar — so a build that ran a gradient off the stage's edge
// is not read as carrying the sky.
//
// THE VERDICT. Every sampled point of every bar is within `BAR_TOLERANCE` of the
// stage's own background colour.

import { afterEach, it } from "vitest";
import { assertLessThan } from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  darkestOf,
  openTitle,
  sampleColor,
  type Harness,
  type Point,
} from "../harness";

/** The two surfaces the stage is letterboxed on: one wider, one taller. */
const SHAPES = [
  { name: "wider", cssWidth: 1600, cssHeight: 720 },
  { name: "taller", cssWidth: 1280, cssHeight: 1000 },
] as const;

/** The stage-edge patches the background colour is read off. */
const SKY: readonly Point[] = [
  { x: 6, y: 6 },
  { x: STAGE_W - 6, y: 6 },
  { x: 6, y: STAGE_H - 6 },
  { x: STAGE_W - 6, y: STAGE_H - 6 },
  { x: STAGE_W / 2, y: 6 },
  { x: 6, y: STAGE_H / 2 },
];

/** The points read in the bars, by which shape put them there. */
const BARS: Readonly<Record<string, readonly Point[]>> = {
  wider: [
    { x: -12, y: STAGE_H / 2 },
    { x: -120, y: STAGE_H / 4 },
    { x: STAGE_W + 12, y: STAGE_H / 2 },
    { x: STAGE_W + 120, y: (3 * STAGE_H) / 4 },
  ],
  taller: [
    { x: STAGE_W / 2, y: -12 },
    { x: STAGE_W / 4, y: -100 },
    { x: STAGE_W / 2, y: STAGE_H + 12 },
    { x: (3 * STAGE_W) / 4, y: STAGE_H + 100 },
  ],
};

/**
 * How far a bar's colour may sit from the stage's background, in RGB distance.
 *
 * `CHANNEL_EPSILON` (`8`) is the case's span for one channel of two pixels being
 * the same colour; this is that span on every channel at once, so a bar cleared to
 * the background passes at any rounding and one cleared to some other colour — a
 * plain black behind a blue-black sky, say — does not.
 */
const BAR_TOLERANCE = 8 * Math.sqrt(3);

let open: Harness[] = [];

afterEach(async () => {
  for (const harness of open) await harness.dispose();
  open = [];
});

it("clears the bars either side of the fitted stage to the stage's own background", async () => {
  for (const shape of SHAPES) {
    const h = await createHarness({
      cssWidth: shape.cssWidth,
      cssHeight: shape.cssHeight,
    });
    open.push(h);
    await openTitle(h);
    await captureStill(h, "bars");

    const sky = await darkestOf(h, SKY, 3);
    for (const point of BARS[shape.name] as readonly Point[]) {
      const bar = await sampleColor(h, point.x, point.y, 3);
      assertLessThan(
        colorDistance(bar, sky),
        BAR_TOLERANCE,
        `on a ${shape.cssWidth} x ${shape.cssHeight} surface the bar at the logical point (${point.x}, ${point.y}) carries the stage's own background colour, so the sky runs to the edge of the window`,
      );
    }
  }
});
