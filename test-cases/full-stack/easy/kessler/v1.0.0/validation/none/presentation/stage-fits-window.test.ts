// presentation/stage-fits-window — the whole 1000 x 1000 stage is on screen,
// in proportion and centered, whatever shape the window is.
//
// specs/overview.md fixes the fit: "Fitting it to the browser window is the
// runtime's: the uniform scale that preserves the aspect ratio, the letterboxed
// centering, and the device pixel ratio. The complete stage is therefore on
// screen at every window size, on load and at any pixel density, filling the
// window's short side." An engineless build derives that fit itself, so the
// harness computes the fit the SPECIFICATION requires and every reading is
// taken against that, never against anything the build reports about itself.
//
// TWO READINGS, OVER FOUR WINDOWS — wider than the stage, taller than it, and
// at a raised device pixel ratio, the three surfaces the item names, against
// the stage's own size where the fit is the identity.
//
// The first is the backing store the build sized, read on the first frame
// before anything is posed: the window at the device pixel ratio, with the
// stage at the specified uniform scale inside it on both axes.
//
// The second is the picture. One scene is posed at the stage's own size and
// the colors at nine logical points are read; the same scene is posed on each
// other window and the same nine LOGICAL points are read through the specified
// fit. A build that scaled the axes apart, cropped, ignored the pixel ratio,
// or drew the stage into a corner puts something else under those points.
// Every point is the middle of a flat, DETERMINISTIC area — the planet
// sprite's center and posed target arcs on the still rings — because the
// starfield's texture is the build's own and need not repeat between the
// separate pages each window opens, while a posed world is the same world on
// every one of them. Ring 3's arc centers reach radius 442 toward all four
// edges, so a crop shows up at the extremes first.
//
// WHY THE COMPARISON IS BETWEEN WINDOWS RATHER THAN AGAINST A COLOR: the
// specification fixes no palette, so what a correct fit puts at a logical
// point is "whatever this build draws there", and the honest reading is that
// the same logical point holds the same thing at every size. The points are
// first checked to be carrying visibly different things from each other, so a
// blank canvas cannot pass by matching blank against blank.

import { afterEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import {
  pointAt,
  ringMidRadius,
  RINGS,
  slotArcCenterDeg,
  STAGE_H,
  STAGE_W,
} from "../constants";
import {
  advanceTicks,
  captureStill,
  colorDistance,
  isolate,
  openHarness,
  samplePoints,
  type Harness,
  type HarnessOptions,
  type Rgb,
} from "../harness";

/** Two points carrying clearly different pieces of the scene, RGB 0–441. */
const DISTINCT_MIN = 50;

/**
 * How far a point's color may sit from the same point read at the stage's own
 * size: half the line for "clearly apart". The stage is resampled onto every
 * other surface, so a center pixel is reconstructed rather than copied and an
 * exact match is not owed; a point carrying a DIFFERENT piece of the scene, or
 * nothing, sits far outside this.
 */
const MATCH_MAX = DISTINCT_MIN / 2;

/** The posed target arcs the points sit on: ring 1 spread, ring 3 extremes. */
const RING1_SLOTS = [0, 3, 6, 9] as const;
const RING3_SLOTS = [0, 5, 10, 15] as const;

const SURFACES: readonly ({ name: string } & HarnessOptions)[] = [
  {
    name: "a window wider than the stage",
    cssWidth: 1600,
    cssHeight: 720,
    dpr: 1,
  },
  {
    name: "a window taller than the stage",
    cssWidth: 720,
    cssHeight: 1100,
    dpr: 1,
  },
  {
    name: "a small window at twice the pixel ratio",
    cssWidth: 800,
    cssHeight: 600,
    dpr: 2,
  },
];

/** The nine logical points every window is read at. */
const READ_POINTS: readonly { x: number; y: number }[] = [
  { x: 500, y: 500 },
  ...RING1_SLOTS.map((slot) =>
    pointAt(ringMidRadius(1), slotArcCenterDeg(1, slot)),
  ),
  ...RING3_SLOTS.map((slot) =>
    pointAt(ringMidRadius(3), slotArcCenterDeg(3, slot)),
  ),
];

let harnesses: Harness[] = [];

afterEach(async () => {
  for (const h of harnesses) await h.dispose();
  harnesses = [];
});

async function open(options?: HarnessOptions): Promise<Harness> {
  const h = await openHarness(options);
  harnesses.push(h);
  return h;
}

/** Pose the one deterministic scene every window is read on. */
async function readScene(h: Harness): Promise<Rgb[]> {
  await isolate(h);
  await h.debug.setRingSpeed(3, 0);
  for (const slot of RING1_SLOTS)
    await h.debug.spawnTarget(1, slot, RINGS[0].hp);
  for (const slot of RING3_SLOTS)
    await h.debug.spawnTarget(3, slot, RINGS[2].hp);
  await advanceTicks(h, 1);
  const samples = await samplePoints(h, READ_POINTS);
  return samples;
}

it("holds the whole stage, in proportion and centered, on every window shape", async () => {
  // The stage at its own size: the specified fit is the identity here, so this
  // is what the build draws with no fitting to argue about.
  const reference = await open();
  const atStage = await readScene(reference);

  const spread = atStage.flatMap((a, i) =>
    atStage.slice(i + 1).map((b) => colorDistance(a, b)),
  );
  assertGreaterThan(
    Math.max(...spread),
    DISTINCT_MIN,
    "the widest RGB distance among the points read at the stage's own size",
  );

  for (const surface of SURFACES) {
    const h = await open(surface);
    const cssWidth = surface.cssWidth ?? STAGE_W;
    const cssHeight = surface.cssHeight ?? STAGE_H;
    const dpr = surface.dpr ?? 1;

    // The backing store, read before anything is posed: the fit is the one the
    // build reaches on load.
    const store = await h.surface();
    assertCloseTo(
      store.dpr,
      dpr,
      6,
      `the device pixel ratio on ${surface.name}`,
    );
    assertEqual(
      store.width,
      Math.round(cssWidth * dpr),
      `the backing store's width on ${surface.name}`,
    );
    assertEqual(
      store.height,
      Math.round(cssHeight * dpr),
      `the backing store's height on ${surface.name}`,
    );

    // The complete stage, at the one uniform scale the specification fixes,
    // fits inside that store on both axes.
    const scale = Math.min(cssWidth / STAGE_W, cssHeight / STAGE_H) * dpr;
    assertLessThanOrEqual(
      STAGE_W * scale,
      store.width + 1e-6,
      `the fitted stage's width against the backing store on ${surface.name}`,
    );
    assertLessThanOrEqual(
      STAGE_H * scale,
      store.height + 1e-6,
      `the fitted stage's height against the backing store on ${surface.name}`,
    );

    const read = await readScene(h);
    if (surface.cssWidth === 1600) {
      // The wide window is the one worth a picture: the whole stage inside it
      // with a bar either side.
      await captureStill(h, "fit");
    }
    for (let point = 0; point < READ_POINTS.length; point += 1) {
      const at = READ_POINTS[point];
      assertLessThanOrEqual(
        colorDistance(read[point], atStage[point]),
        MATCH_MAX,
        `the RGB distance at (${Math.round(at.x)}, ${Math.round(at.y)}) on ` +
          `${surface.name}, against the same point at the stage's own size`,
      );
    }
  }
});
