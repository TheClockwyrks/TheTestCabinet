// floor/stage-fit — the whole 1280x720 stage is on screen, fitted and centred, at
// every window shape and pixel density, from the moment the page loads.
//
// THE RULE. `specs/overview.md`: "`STAGE_W x STAGE_H` is the game's logical design
// size. Fitting it to the browser window is the runtime's work: the uniform scale
// that preserves the aspect ratio, the letterboxed centering, and the device pixel
// ratio. The complete stage is therefore on screen at every window size, on load
// and at any pixel density, with the whole floor, the whole build panel, and all
// four edges visible and nothing clipped." And: "Draw in logical units, and take
// the canvas element's own size from the runtime alone."
//
// UNDER AN ENGINE THIS IS THE ENGINE'S WORK; HERE IT IS THE BUILD'S, and that is
// what the check has to be written around. There is no viewport map to ask for,
// and asking the build what map it derived would be asking it to grade itself. So
// the harness computes the fit the SPECIFICATION requires — `fitViewport`, one
// uniform scale, the leftover split evenly into two bars — and every reading below
// is taken at the place that fit puts the thing.
//
// THREE READINGS, OVER SIX SHAPES.
//
//   1. THE BACKING STORE, which is arithmetic a build cannot argue with: the
//      canvas is the window at the device pixel ratio. `index.html` is supplied
//      and not the build's to edit, and it lays the canvas out at `100vw` by
//      `100vh`, so the window's size IS the element's size and the store must be
//      that times the ratio. Read before anything is driven, because "on load,
//      before any input" is part of the requirement.
//   2. THE FIT ITSELF, against the same four numbers: the scale is the uniform
//      one, the whole stage is inside the store on both axes, the leftover is
//      split evenly so the stage is centred, one axis is filled exactly so the
//      letterboxing is on the other alone, and all four stage corners land inside
//      the store.
//   3. THE PICTURE, which is what makes the first two more than arithmetic. Four
//      towers are built on the floor's four extreme corner tiles and the panel is
//      asked where it drew its controls; then the pixels at the logical points the
//      specified fit maps those to are read. A build that scaled non-uniformly,
//      cropped, ignored the pixel ratio, or drew in device pixels has nothing at
//      those points.
//
// HOW THE PICTURE IS READ, AND WHY IT IS A DIFFERENCE RATHER THAN A COLOUR.
// `specs/overview.md` fixes no palette, so a tower's colour and the floor's are
// both the build's. The floor is therefore rendered twice with nothing built —
// which also measures how much the build's own art moves between two frames — and
// then again with the four towers standing; a corner counts as drawn where the
// third frame differs from the second by more than both a fixed floor and that
// measured movement. Nothing here says what colour a tower is.
//
// WHY THE PANEL IS READ AS GEOMETRY. Whether the panel's own ground is painted
// over the strip is not decidable from out here without fixing a palette (see
// `floor/panel-strip`), so what this check reads of the panel is that every
// control it reports lands INSIDE the backing store once mapped through the
// specified fit — which is what "the whole build panel visible" means at a window
// shape the panel was not designed around.
//
// EACH SHAPE IS A WINDOW OF ITS OWN. A device pixel ratio belongs to a browser
// context rather than to a page, so `createHarness` opens one per shape and the
// build meets each as a fresh page — which is also the state the requirement is
// about.

import { afterEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
  assertNotNull,
  assertTrue,
} from "../assert";
import {
  COLS,
  ROWS,
  STAGE_H,
  STAGE_W,
  TOWER_DEFS,
  TOWER_TYPES,
  type Rect,
  tileCX,
  tileCY,
} from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  poseTower,
  startRun,
  type Harness,
} from "../harness";
import { readPixels, type Point } from "./read";

/** The three window shapes, at each of two pixel densities. */
const SHAPES: readonly {
  name: string;
  cssWidth: number;
  cssHeight: number;
}[] = [
  {
    name: "a window the size of the stage",
    cssWidth: STAGE_W,
    cssHeight: STAGE_H,
  },
  { name: "a window wider than the stage", cssWidth: 1600, cssHeight: 720 },
  { name: "a window taller than the stage", cssWidth: 1024, cssHeight: 900 },
];

const DENSITIES: readonly number[] = [1, 2];

const SURFACES = SHAPES.flatMap((shape) =>
  DENSITIES.map((dpr) => ({
    ...shape,
    dpr,
    label: `${shape.name} at ${dpr}x`,
  })),
);

/**
 * How far a pixel must move, out of the 441 the RGB cube spans, to count as the
 * tower having been drawn there.
 *
 * The same figure `floor/tile-map` and `floor/grid-visible` use for a step a
 * player can see: under two per cent of the scale, so a build whose towers are
 * quiet against its floor is not failed for being quiet, and a floor nothing was
 * drawn on reads as untouched.
 */
const DRAWN_MIN = 8;

/** How far above two identical frames' own movement a reading must sit, on top of it. */
const NOISE_MARGIN = DRAWN_MIN;

/** The four extreme corner tiles a 2x2 footprint fits on. */
const TYPE = "arc";
const SIZE = TOWER_DEFS[TYPE].size;
const CORNERS: readonly { name: string; col: number; row: number }[] = [
  { name: "the floor's top-left corner", col: 0, row: 0 },
  { name: "the floor's top-right corner", col: COLS - SIZE, row: 0 },
  { name: "the floor's bottom-left corner", col: 0, row: ROWS - SIZE },
  {
    name: "the floor's bottom-right corner",
    col: COLS - SIZE,
    row: ROWS - SIZE,
  },
];

/** The tile centres of one corner footprint: where the body must be found. */
function footprintProbes(corner: { col: number; row: number }): Point[] {
  const probes: Point[] = [];
  for (let c = corner.col; c < corner.col + SIZE; c += 1) {
    for (let r = corner.row; r < corner.row + SIZE; r += 1) {
      probes.push({ x: tileCX(c), y: tileCY(r) });
    }
  }
  return probes;
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

it.each(SURFACES)(
  "fits the whole stage into $label, centred and unclipped",
  async ({ cssWidth, cssHeight, dpr, label }) => {
    const h = await surface({ cssWidth, cssHeight, dpr });

    // 1. The backing store, before anything is driven: the window at the ratio.
    const store = await h.surface();
    assertCloseTo(store.dpr, dpr, 6, `${label}: the ratio the page reports`);
    assertEqual(
      store.width,
      Math.round(cssWidth * dpr),
      `${label}: the canvas's backing-store width, in device pixels`,
    );
    assertEqual(
      store.height,
      Math.round(cssHeight * dpr),
      `${label}: the canvas's backing-store height, in device pixels`,
    );

    // 2. The fit the specification requires, over a store of exactly that size.
    const view = h.viewport();
    const uniform = Math.min(cssWidth / STAGE_W, cssHeight / STAGE_H) * dpr;
    assertEqual(view.width, STAGE_W, `${label}: the logical stage width`);
    assertEqual(view.height, STAGE_H, `${label}: the logical stage height`);
    assertCloseTo(view.scale, uniform, 9, `${label}: one uniform scale`);
    // The whole stage is inside the store on both axes.
    assertLessThanOrEqual(
      STAGE_W * view.scale,
      store.width + 1e-6,
      `${label}: the stage's width, scaled, inside the store`,
    );
    assertLessThanOrEqual(
      STAGE_H * view.scale,
      store.height + 1e-6,
      `${label}: the stage's height, scaled, inside the store`,
    );
    // The leftover is split evenly into two bars, and one axis is filled
    // exactly, so the letterboxing is on the other alone.
    assertCloseTo(
      view.offsetX * 2 + STAGE_W * view.scale,
      store.width,
      6,
      `${label}: the two bars either side sum to the leftover width`,
    );
    assertCloseTo(
      view.offsetY * 2 + STAGE_H * view.scale,
      store.height,
      6,
      `${label}: the two bars above and below sum to the leftover height`,
    );
    assertCloseTo(
      Math.min(view.offsetX, view.offsetY),
      0,
      6,
      `${label}: one axis filled exactly, so the letterboxing is on one axis`,
    );
    // And all four edges of the stage are on screen.
    for (const corner of [
      { name: "top-left", x: 0, y: 0 },
      { name: "top-right", x: STAGE_W, y: 0 },
      { name: "bottom-left", x: 0, y: STAGE_H },
      { name: "bottom-right", x: STAGE_W, y: STAGE_H },
    ]) {
      const at = h.device(corner.x, corner.y);
      assertTrue(
        at.x >= 0 && at.x <= store.width && at.y >= 0 && at.y <= store.height,
        `${label}: the stage's ${corner.name} corner lands inside the ` +
          `${store.width}x${store.height} backing store; it lands at ` +
          `(${at.x}, ${at.y})`,
      );
    }

    // 3. The picture: the floor is really drawn through that map, out to its own
    // four corners, and the panel's controls are all on screen.
    await startRun(h);
    const probes = CORNERS.flatMap((corner) => footprintProbes(corner));

    await h.advance(1);
    const before = await readPixels(h, probes);
    await h.advance(1);
    const quiet = await readPixels(h, probes);

    for (const corner of CORNERS)
      await poseTower(h, TYPE, corner.col, corner.row);
    await h.advance(1);
    if (cssWidth === 1600 && dpr === 1) {
      // The off-aspect shape is the one worth keeping: the whole stage fitted
      // inside a window it does not fill, with a bar either side, is what this
      // point is about and is invisible at the stage's own size.
      await captureStill(h, "fitted");
    }
    const standing = await readPixels(h, probes);

    const perCorner = SIZE * SIZE;
    for (const [index, corner] of CORNERS.entries()) {
      let best = 0;
      for (let n = 0; n < perCorner; n += 1) {
        const i = index * perCorner + n;
        const noise = colorDistance(before[i], quiet[i]);
        const shift = colorDistance(quiet[i], standing[i]);
        if (shift >= noise + NOISE_MARGIN) best = Math.max(best, shift);
      }
      assertGreaterThanOrEqual(
        best,
        DRAWN_MIN,
        `${label}: the tower built on ${corner.name}, tile ` +
          `(${corner.col}, ${corner.row}), is drawn at the device pixels the ` +
          `specified fit maps that footprint to`,
      );
    }

    const { controls } = await h.snapshot();
    const named: { name: string; rect: Rect | null }[] = [
      ...controls.shop.map((entry) => ({
        name: `the ${entry.type} shop entry`,
        rect: entry as Rect,
      })),
      { name: "Send", rect: controls.send },
      { name: "the speed toggle", rect: controls.speed },
      { name: "Pause", rect: controls.pause },
      { name: "the mute control", rect: controls.mute },
    ];
    assertGreaterThanOrEqual(
      controls.shop.length,
      TOWER_TYPES.length,
      `${label}: the shop entries the panel reports, each of which has to fit ` +
        "inside the backing store (specs/hud.md, The shop)",
    );
    for (const { name, rect } of named) {
      assertNotNull(
        rect,
        `${label}: the rectangle the panel reports for ${name}, which cannot ` +
          "be checked for fit until the panel reports one (specs/hud.md)",
      );
      if (rect === null) continue;
      for (const point of [
        { x: rect.x, y: rect.y },
        { x: rect.x + rect.w, y: rect.y + rect.h },
      ]) {
        const at = h.device(point.x, point.y);
        assertTrue(
          at.x >= 0 && at.x <= store.width && at.y >= 0 && at.y <= store.height,
          `${label}: ${name}, which the panel reports at (${rect.x}, ${rect.y}) ` +
            `${rect.w}x${rect.h}, lands inside the ${store.width}x` +
            `${store.height} backing store; its corner lands at (${at.x}, ${at.y})`,
        );
      }
    }
  },
);
