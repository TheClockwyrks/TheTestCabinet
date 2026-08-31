// presentation/stage-fits-window — the whole 1000 x 1000 stage is on screen,
// in proportion and centered, whatever shape the window is.
//
// specs/overview.md fixes the fit: the uniform scale that preserves the aspect
// ratio, the letterboxed centering, and the device pixel ratio, so that "the
// complete stage is therefore on screen at every window size, on load and at
// any pixel density, filling the window's short side." Under this engine the
// mapping itself is the engine's work and the build's part is drawing in the
// logical space that mapping is of, so both halves are read: the mapping the
// build's engine derived, and the picture the build drew through it.
//
// TWO READINGS, OVER FOUR WINDOWS — wider than the stage, taller than it, and
// at a raised device pixel ratio, the three surfaces the item names, against
// the stage's own size where the fit is the identity.
//
// The first is the mapping, read on the first frame before anything is posed:
// one uniform scale, the largest that keeps the whole stage inside the
// surface, with even bars either side of it.
//
// The second is the picture. One scene is posed at the stage's own size and
// the colors at nine logical points are read; the same scene is posed on each
// other window and the same nine LOGICAL points are read through the mapping.
// A build that drew in device pixels, reset the transform, or scaled its own
// drawing a second time puts something else under those points. Every point
// is the middle of a flat, DETERMINISTIC area — the planet sprite's center
// and posed target arcs on the still rings — because the starfield's texture
// is the build's own and need not repeat between the separate sessions each
// window opens, while a posed world is the same world on every one of them.
// Ring 3's arc centers reach radius 442 toward all four edges, so a crop
// shows up at the extremes first.
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
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { RING_SPECS, STAGE_H, STAGE_W } from "../constants";
import {
  advanceTicks,
  captureStill,
  colorDistance,
  isolate,
  openHarness,
  polarToXy,
  sampleAt,
  slotArcCenterDeg,
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

/** How far the two letterbox bars on one axis may differ, in device pixels. */
const CENTERED_MAX = 1;

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
    polarToXy(RING_SPECS[0].midRadius, slotArcCenterDeg(1, slot, 0)),
  ),
  ...RING3_SLOTS.map((slot) =>
    polarToXy(RING_SPECS[2].midRadius, slotArcCenterDeg(3, slot, 0)),
  ),
];

let harnesses: Harness[] = [];

afterEach(() => {
  for (const h of harnesses) h.dispose();
  harnesses = [];
});

async function open(options?: HarnessOptions): Promise<Harness> {
  const h = await openHarness(options);
  harnesses.push(h);
  return h;
}

/** Pose the one deterministic scene every window is read on. */
async function readScene(h: Harness): Promise<Rgb[]> {
  isolate(h);
  h.debug.setRingSpeed(3, 0);
  for (const slot of RING1_SLOTS)
    h.debug.spawnTarget(1, slot, RING_SPECS[0].hitPoints);
  for (const slot of RING3_SLOTS)
    h.debug.spawnTarget(3, slot, RING_SPECS[2].hitPoints);
  await advanceTicks(h, 1);
  return READ_POINTS.map((at) => sampleAt(h, at.x, at.y));
}

it("holds the whole stage, in proportion and centered, on every window shape", async () => {
  // The stage at its own size: the fit is the identity here, so this is what
  // the build draws with no fitting to argue about.
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
    const store = {
      width: Math.round(cssWidth * dpr),
      height: Math.round(cssHeight * dpr),
    };

    // The mapping, read before anything is posed: the fit is the one the build
    // reaches on load.
    const view = h.viewport();
    const scale = Math.min(cssWidth / STAGE_W, cssHeight / STAGE_H) * dpr;
    assertCloseTo(
      view.scale,
      scale,
      6,
      `the uniform scale the stage is fitted at on ${surface.name}`,
    );
    assertLessThanOrEqual(
      view.offsetX + STAGE_W * view.scale,
      store.width + 1e-6,
      `the fitted stage's right edge against the backing store on ${surface.name}`,
    );
    assertLessThanOrEqual(
      view.offsetY + STAGE_H * view.scale,
      store.height + 1e-6,
      `the fitted stage's bottom edge against the backing store on ${surface.name}`,
    );
    assertLessThanOrEqual(
      Math.abs(store.width - STAGE_W * view.scale - 2 * view.offsetX),
      CENTERED_MAX,
      `the difference between the left and right letterbox bars on ${surface.name}`,
    );
    assertLessThanOrEqual(
      Math.abs(store.height - STAGE_H * view.scale - 2 * view.offsetY),
      CENTERED_MAX,
      `the difference between the top and bottom letterbox bars on ${surface.name}`,
    );

    const read = await readScene(h);
    if (surface.cssWidth === 1600) {
      // The wide window is the one worth a picture: the whole stage inside it
      // with a bar either side.
      captureStill(h, "fit");
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
