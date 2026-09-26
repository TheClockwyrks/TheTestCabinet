// presentation/stage-fits-a-raised-device-pixel-ratio — at twice the pixel density
// the whole stage is still on screen at its own ratio, and the game still draws in
// logical units.
//
// THE RULE, two sentences of `specs/overview.md`'s Coordinate system and
// presentation: "Fitting it to the browser window is the runtime's: the uniform
// scale that preserves the aspect ratio, the letterboxed centering, and the device
// pixel ratio. The complete stage is therefore on screen at every window size, on
// load and at any pixel density." And: "Draw in logical units, and take the canvas
// element's own size from the runtime alone."
//
// THE SURFACE. The stage's own `1280 x 720`, at a device pixel ratio of `2`. The
// window has not changed shape, so there are no bars and the whole surface is
// stage; what changed is that one logical unit is now two device pixels.
//
// WHAT THE DENSITY IS READ AS. The canvas the build sized carries
// `1280 * 2 x 720 * 2` device pixels — "take the canvas element's own size from
// the runtime alone" — rather than the `1280 x 720` a build that ignored the ratio
// would leave, which is what would make the picture soft at that density.
//
// AND WHAT "IN LOGICAL UNITS" IS READ AS. A mote spawned on a hex is looked for
// at that hex's own LOGICAL centre, on the same square of the stage at both
// densities. A build that took the raised backing store and went on drawing at
// device coordinates of its own puts nothing there; one that drew in logical
// units under the runtime's scale draws it where the hex is. How much of the
// square the mote covers is not read, because a picture rasterized at two
// densities is not the same pixels either way.
//
// THE STAGE IS STILL WHOLE. Four motes on the hexes furthest out on the field's
// axes are each looked for at their own logical hex centre, and the stage's four
// corners are read as pixels — on screen exactly when the fitted stage lies inside
// the canvas the build sized.
//
// THE VERDICT. The canvas carries the window's size times the ratio, all four
// landmarks are drawn at their logical hex centres, the stage's corners are on the
// surface, and a mote is drawn on the square about its own hex at both densities.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import { at, hexCenter, type Hex } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  differingShare,
  openBareRun,
  spawnMote,
  type Harness,
  type PixelRect,
} from "../harness";

/** The density the stage is fitted at. */
const DPR = 2;

/** The four hexes furthest out on the field's axes (`specs/field.md`, `FIELD_R`). */
const LANDMARKS: readonly Hex[] = [at(-5, 0), at(5, 0), at(0, -5), at(0, 5)];

/** Half the side of the square a landmark is read over; inside its own hex. */
const HALF = 16;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({
    cssWidth: STAGE_W,
    cssHeight: STAGE_H,
    dpr: DPR,
  });
});

afterEach(async () => {
  await h.dispose();
});

function square(harness: Harness, hex: Hex): Promise<PixelRect> {
  const centre = hexCenter(hex);
  return harness.pixelRect(
    centre.x - HALF,
    centre.y - HALF,
    2 * HALF,
    2 * HALF,
  );
}

/** How much of the square about `hex` one mote spawned there redraws. */
async function shareOfOneMote(harness: Harness, hex: Hex): Promise<number> {
  await openBareRun(harness, { challenge: BARE, paused: true });
  await harness.advance(1);
  const bare = await square(harness, hex);
  await spawnMote(harness, hex, "sol");
  await harness.advance(1);
  return differingShare(bare, await square(harness, hex));
}

it("draws the whole stage at a raised pixel density, in the same logical units", async () => {
  await openBareRun(h, { challenge: BARE, paused: true });
  await h.advance(1);

  // READ AFTER A FRAME HAS DRAWN, because sizing the canvas is part of drawing
  // one: `specs/overview.md` gives the runtime the fit and the density, and a
  // runtime that owns the fit sizes its canvas on the frame it fits. Read before
  // any frame this harness drove, what comes back is whatever the element
  // happened to carry, which is a fact about when the page got here rather than
  // about the build.
  const surface = await h.surface();
  assertEqual(
    surface.width,
    STAGE_W * DPR,
    `the canvas the build sized carries ${STAGE_W} logical units at ${DPR} device pixels each, so the runtime took the device pixel ratio`,
  );
  assertEqual(
    surface.height,
    STAGE_H * DPR,
    `the canvas the build sized carries ${STAGE_H} logical units at ${DPR} device pixels each, so the runtime took the device pixel ratio`,
  );

  const bare: PixelRect[] = [];
  for (const hex of LANDMARKS) bare.push(await square(h, hex));

  for (const hex of LANDMARKS) await spawnMote(h, hex, "sol");
  await h.advance(1);
  await captureStill(h, "dpr");

  for (const [index, hex] of LANDMARKS.entries()) {
    assertGreaterThan(
      differingShare(bare[index] as PixelRect, await square(h, hex)),
      0,
      `the mote on hex (${hex.q}, ${hex.r}) is drawn at that hex's own stage position at a device pixel ratio of ${DPR}, so the complete stage is still fitted at its own aspect ratio`,
    );
  }

  const corners = await h.pixels([
    { x: 1, y: 1 },
    { x: STAGE_W - 1, y: 1 },
    { x: 1, y: STAGE_H - 1 },
    { x: STAGE_W - 1, y: STAGE_H - 1 },
  ]);
  assertLength(
    corners,
    4,
    "all four corners of the 1280 x 720 stage fall on the canvas, so the complete stage is on screen at the raised density",
  );

  // The same scene at the density a logical unit is a device pixel at, so the
  // reading is taken at both densities and what it can differ by is the density.
  const plain = await createHarness({ cssWidth: STAGE_W, cssHeight: STAGE_H });
  try {
    assertGreaterThan(
      await shareOfOneMote(plain, ORIGIN),
      0,
      "one mote is drawn on the square about its own hex at a ratio of 1, which is the reading the raised density is taken against",
    );
    assertGreaterThan(
      await shareOfOneMote(h, ORIGIN),
      0,
      `and on the same square of the STAGE at a device pixel ratio of ${DPR}, so the game still draws in logical units and the runtime alone carries the density`,
    );
  } finally {
    await plain.dispose();
  }
});
