// presentation/window-fit — the whole stage stays on screen, in proportion and
// centred, whatever shape the window is.
//
// UNDER AN ENGINE THIS IS THE ENGINE'S WORK; HERE IT IS THE BUILD'S. That is why
// this point is scoped to `none`. `specs/overview.md` fixes the fit — "the
// uniform scale that preserves the aspect ratio, the letterboxed centering, and
// the device pixel ratio", so that "the complete stage is therefore on screen at
// every window size, on load and at any pixel density" — and an engineless build
// derives it itself, while an engine supplies it to every build alike. So the
// harness computes the fit the SPECIFICATION requires and the readings are taken
// against that; asking the build what it derived would be asking it to grade
// itself.
//
// TWO READINGS, OVER SIX WINDOWS.
//
// The first is the build's own backing store, which it sized: it has to be the
// window at the device pixel ratio. That is read on the build's first frame,
// before anything is posed and before a key is pressed, because the requirement
// is about the fit a build reaches on load.
//
// The second is WHERE THE BUILD DREW. `specs/assets.md` has the snake drawn from
// produced sprites, and the harness reads each blit's rectangle mapped through
// the transform in force at the call — so the centre of every blit of a frame is
// a device-space reading of a point the build placed in logical space. One scene
// is posed at the stage's own size, where the specified fit is the identity and
// the extent those centres span is therefore the LOGICAL extent of the frame's
// own draws. The same scene is posed on each other window, and the extent is read
// again: under the specified fit it has to be that same logical rectangle scaled
// by the one uniform scale and centred in the backing store. A build that scaled
// the two axes differently, that ignored the pixel ratio, or that drew the stage
// into a corner instead of centring it puts the rectangle somewhere else.
//
// WHY A DEVICE PIXEL OF SLACK. A build is free to snap a destination rectangle to
// a whole device pixel so its pixel art lands on the grid, which moves a blit's
// centre by up to half a pixel at each end of the extent. Nothing a wrong fit can
// do is that small: the smallest of these windows scales the stage by less than a
// half, so a stage drawn uncentred or at the wrong ratio is out by tens of pixels.
//
// EACH SHAPE IS A WINDOW OF ITS OWN. A device pixel ratio belongs to a browser
// context rather than to a page, so `createHarness` opens one per shape and the
// build meets each as a fresh page, which is the state the requirement is about.

import { afterEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertLessThanOrEqual,
  fail,
} from "../assert";
import type { Cell } from "../constants";
import {
  blitCenter,
  captureStill,
  chainFrom,
  createHarness,
  HOME_HEAD,
  poseScene,
  type Blit,
  type Harness,
} from "../harness";

/** Where the pellet is posed, clear of the chain. */
const PELLET_CELL: Cell = { col: 20, row: 5 };

/** The rectangle a frame's own draws span, corner to corner. */
interface Extent {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * How far a read corner may sit from where the specified fit puts it, in device
 * pixels: one.
 *
 * A build is free to round a destination rectangle to the device pixel grid,
 * which moves a blit's centre by up to half a pixel; this covers that and
 * nothing a wrong fit produces.
 */
const CORNER_SLACK = 1;

const SURFACES = [
  {
    name: "a window wider than the stage",
    cssWidth: 1600,
    cssHeight: 720,
    dpr: 1,
  },
  {
    name: "a window taller than the stage",
    cssWidth: 1280,
    cssHeight: 900,
    dpr: 1,
  },
  {
    name: "a small window at twice the pixel ratio",
    cssWidth: 800,
    cssHeight: 450,
    dpr: 2,
  },
  {
    name: "an off-aspect window at a fractional ratio",
    cssWidth: 1000,
    cssHeight: 500,
    dpr: 1.5,
  },
  { name: "a portrait window", cssWidth: 600, cssHeight: 900, dpr: 1 },
];

let harnesses: Harness[] = [];

afterEach(async () => {
  for (const h of harnesses) await h.dispose();
  harnesses = [];
});

async function open(options?: {
  cssWidth: number;
  cssHeight: number;
  dpr: number;
}): Promise<Harness> {
  const h = await createHarness(options);
  harnesses.push(h);
  return h;
}

/** The rectangle the centres of `blits` span. */
function extentOf(blits: readonly Blit[], where: string): Extent {
  if (blits.length === 0) {
    fail(
      "a frame drawing the snake from the produced sprites (specs/assets.md)",
      `no bitmap was blitted on ${where}`,
    );
  }
  const centres = blits.map(blitCenter);
  return {
    x0: Math.min(...centres.map((c) => c.x)),
    y0: Math.min(...centres.map((c) => c.y)),
    x1: Math.max(...centres.map((c) => c.x)),
    y1: Math.max(...centres.map((c) => c.y)),
  };
}

/** Pose the one scene every window is read on, and read what it drew. */
async function drawnExtent(h: Harness, where: string): Promise<Extent> {
  await poseScene(h, {
    snake: chainFrom(HOME_HEAD, "right", 4),
    dir: "right",
    pellet: PELLET_CELL,
    travel: false,
  });
  return extentOf(await h.frameBlits(), where);
}

it("holds the whole stage, in proportion and centred, on every window shape", async () => {
  // The stage at its own size: the specified fit is the identity here, so the
  // extent read is the LOGICAL rectangle the frame's own draws span.
  const reference = await open();
  const logical = await drawnExtent(
    reference,
    "a window the size of the stage",
  );

  for (const surface of SURFACES) {
    const h = await open(surface);

    // One frame, and then the reading. A build sizes its backing store as part of
    // drawing, so a canvas that has not drawn yet is still at the `300 x 150` an
    // HTML element carries — that is the page's scheduling and says nothing about
    // the build. Nothing is posed and no key is pressed before it, so what is read
    // is still the fit the build reaches on load.
    await h.advance(1);
    const store = await h.surface();
    assertCloseTo(
      store.dpr,
      surface.dpr,
      6,
      `the device pixel ratio on ${surface.name}`,
    );
    assertEqual(
      store.width,
      Math.round(surface.cssWidth * surface.dpr),
      `the backing store's width on ${surface.name}`,
    );
    assertEqual(
      store.height,
      Math.round(surface.cssHeight * surface.dpr),
      `the backing store's height on ${surface.name}`,
    );

    const read = await drawnExtent(h, surface.name);
    if (surface.cssWidth === 1600) {
      // The off-aspect window is the one worth a picture: the whole stage inside
      // it with a bar either side is what this point is about, and none of that
      // is visible on a surface the size of the stage.
      await captureStill(h, "fit");
    }

    // Where the specified fit puts the two corners of that logical rectangle.
    const topLeft = h.device(logical.x0, logical.y0);
    const bottomRight = h.device(logical.x1, logical.y1);
    const corners: readonly [string, number, number][] = [
      ["the left edge", read.x0, topLeft.x],
      ["the top edge", read.y0, topLeft.y],
      ["the right edge", read.x1, bottomRight.x],
      ["the bottom edge", read.y1, bottomRight.y],
    ];
    for (const [edge, actual, expected] of corners) {
      assertLessThanOrEqual(
        Math.abs(actual - expected),
        CORNER_SLACK,
        `${edge} of what the frame drew on ${surface.name}, against the ${expected} the specified fit puts it at (the build drew it at ${actual})`,
      );
    }
  }
});
