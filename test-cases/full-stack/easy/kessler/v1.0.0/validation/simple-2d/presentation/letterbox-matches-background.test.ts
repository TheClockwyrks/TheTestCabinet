// presentation/letterbox-matches-background — the bars either side of the
// fitted stage carry the stage's own background color.
//
// specs/overview.md: "The letterbox bars around the stage carry the stage's
// background color." A wide window puts a bar left and right of the stage and
// a tall window puts one above and below, so both shapes are read. The stage's
// background color is read off the stage itself — six points in the stage's
// far corners and side midpoints, outside the containment circle where nothing
// but the background and its starfield is drawn, folded to a per-channel
// median so a star under one point cannot pull the reading. Each bar point
// must then sit within a small distance of that color: a bar painted black
// against a tinted stage, or left unpainted, reads far outside it.
//
// The bar points are addressed in LOGICAL coordinates beyond the stage's
// edges, which the engine's mapping lands on the bars; how the stage lands in
// the window is the window-fit item, not this one.

import { afterEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import {
  advanceTicks,
  captureStill,
  colorDistance,
  isolate,
  openHarness,
  samplePoint,
  type Harness,
  type HarnessOptions,
  type Rgb,
} from "../harness";

/**
 * How far a bar's color may sit from the stage's background, RGB 0–441. The
 * bars are flat paint and the median is flat background, so a conformant build
 * reads at 0; the bound only absorbs rounding through the fit.
 */
const BAR_MATCH_MAX = 20;

/** In-stage background: corners and side midpoints, outside the containment. */
const BACKGROUND_POINTS: readonly { x: number; y: number }[] = [
  { x: 30, y: 30 },
  { x: 970, y: 30 },
  { x: 30, y: 970 },
  { x: 970, y: 970 },
  { x: 30, y: 500 },
  { x: 970, y: 500 },
];

const WINDOWS: readonly ({
  name: string;
  bars: readonly { x: number; y: number }[];
} & HarnessOptions)[] = [
  {
    name: "a window wider than the stage",
    cssWidth: 1600,
    cssHeight: 720,
    dpr: 1,
    bars: [
      { x: -150, y: 300 },
      { x: -150, y: 700 },
      { x: 1150, y: 300 },
      { x: 1150, y: 700 },
    ],
  },
  {
    name: "a window taller than the stage",
    cssWidth: 720,
    cssHeight: 1100,
    dpr: 1,
    bars: [
      { x: 300, y: -40 },
      { x: 700, y: -40 },
      { x: 300, y: 1040 },
      { x: 700, y: 1040 },
    ],
  },
];

let harnesses: Harness[] = [];

afterEach(() => {
  for (const h of harnesses) h.dispose();
  harnesses = [];
});

/** The per-channel median of the six in-stage background samples. */
function medianColor(samples: readonly Rgb[]): Rgb {
  const mid = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  return {
    r: mid(samples.map((s) => s.r)),
    g: mid(samples.map((s) => s.g)),
    b: mid(samples.map((s) => s.b)),
  };
}

it("paints the bars in the stage's background color", async () => {
  for (const window of WINDOWS) {
    const h = await openHarness(window);
    harnesses.push(h);

    isolate(h);
    await advanceTicks(h, 1);
    if (window.cssWidth === 1600) captureStill(h, "bars");

    const background = medianColor(
      BACKGROUND_POINTS.map((at) => samplePoint(h, at.x, at.y)),
    );
    for (const at of window.bars) {
      assertLessThanOrEqual(
        colorDistance(samplePoint(h, at.x, at.y), background),
        BAR_MATCH_MAX,
        `the RGB distance between the bar at logical (${at.x}, ${at.y}) and ` +
          `the stage's background on ${window.name}`,
      );
    }
  }
});
