// presentation/stage-fits-window — the build sizes its surface to the window,
// with room on it for the whole 1000 x 1000 stage, whatever shape the window is.
//
// specs/overview.md fixes the fit: "Fitting it to the browser window is the
// runtime's: the uniform scale that preserves the aspect ratio, the letterboxed
// centering, and the device pixel ratio. The complete stage is therefore on
// screen at every window size, on load and at any pixel density, filling the
// window's short side." An engineless build derives that fit itself, so the
// harness computes the fit the SPECIFICATION requires and every reading is
// taken against that, never against anything the build reports about itself.
//
// THE READING, OVER THREE WINDOWS — wider than the stage, taller than it, and
// at a raised device pixel ratio, the three surfaces the item names.
//
// It is the backing store the build sized, read on the first frame before
// anything is posed: the window at the device pixel ratio, with the complete
// stage at the specified uniform scale inside it on both axes. That is as far
// as the fit is read, because it is read off the surface the build reached
// rather than off the picture. WHERE THE STAGE LANDS INSIDE THAT SURFACE — the
// centering, and the bars either side of it — would take a color comparison
// between two windows to read, which is appearance, so the captured still is
// what carries it, and the reviewer's presentation rating is what judges it.
//
// A scene is then posed on each window and the wide one is captured, so the
// reviewer sees the fitted stage with a bar either side. The pose is the
// planet and target arcs on still rings, the same world on every window.

import { afterEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertLessThanOrEqual } from "../assert";
import { RINGS, STAGE_H, STAGE_W } from "../constants";
import {
  advanceTicks,
  captureStill,
  isolate,
  openHarness,
  type Harness,
  type HarnessOptions,
} from "../harness";

/** The posed target arcs: ring 1 spread, ring 3 extremes. */
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

/** Pose the one scene every window is rendered with. */
async function poseScene(h: Harness): Promise<void> {
  await isolate(h);
  await h.debug.setRingSpeed(3, 0);
  for (const slot of RING1_SLOTS)
    await h.debug.spawnTarget(1, slot, RINGS[0].hp);
  for (const slot of RING3_SLOTS)
    await h.debug.spawnTarget(3, slot, RINGS[2].hp);
  await advanceTicks(h, 1);
}

it("sizes the surface to the window, with room for the whole stage", async () => {
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

    await poseScene(h);
    if (surface.cssWidth === 1600) {
      // The wide window is the one worth a picture: the whole stage inside it
      // with a bar either side.
      await captureStill(h, "fit");
    }
  }
});
