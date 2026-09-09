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
// WHERE THE FIT IS READ FROM: THE CANVAS ELEMENT, NOT THE WINDOW. The
// specification fixes the outcome — the stage uniformly scaled, centred in the
// window, at the device pixel ratio, nothing clipped — and hands the runtime the
// canvas element's size. It does not say the element stays the size of the
// window. Two layouts meet it: a canvas that fills the window and letterboxes the
// stage inside its own store, and a canvas the runtime sizes to the fitted stage
// and lets the page centre, with the bars around the element. Read against the
// window alone, the second is graded against a bar it never drew inside its
// store. So the element's box and store are read off the page, the fit of the
// stage INTO THAT BOX is computed, and what is asserted is the COMPOSITE: where
// the page put the element plus where the fit puts the stage inside it must be
// exactly where the specification's fit of the stage into the window puts it.
// Both layouts satisfy that; a stage that is cropped, scaled non-uniformly,
// off-centre, or drawn against the store rather than the fit does not.
//
// THREE READINGS, OVER SIX SHAPES.
//
//   1. THE BACKING STORE, which is arithmetic a build cannot argue with: the
//      canvas element's store is its own on-screen size at the device pixel
//      ratio — "the device pixel ratio" is one of the three things the
//      specification names the fit as doing, and a store that is the element's
//      CSS size, or a fixed size the browser then rescales, is not that. Read
//      before anything is driven, because "on load, before any input" is part
//      of the requirement.
//   2. THE FIT ITSELF: the scale is the uniform one for the WINDOW, the stage
//      composited through the element lands centred in the window with the
//      leftover split evenly, one axis is filled exactly so the letterboxing is
//      on the other alone, and all four stage corners land inside the store.
//   3. THE PICTURE, which is what makes the first two more than arithmetic. Four
//      towers are built on the floor's four extreme corner tiles and the panel is
//      asked where it drew its controls; then the pixels at the device points the
//      specified fit maps those to — inside the element's own store — are read. A
//      build that scaled non-uniformly, cropped, ignored the pixel ratio, or drew
//      in device pixels has nothing at those points.
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
// shape the panel was not designed around. For the same reason the bars' colour
// is not read: which of the stage's own pixels is "the stage's background" is the
// build's to decide, and a check cannot compare a bar to it without fixing one.
//
// WHY THE HARNESS'S OWN PIXEL READERS ARE NOT USED HERE. `h.pixels` and
// `h.device` map a logical point through the fit of the stage into the WINDOW and
// sample the store at that device pixel, which is right for a window-filling
// canvas and wrong for a fitted element whose store holds no bar. Every reading
// below goes through the element's own fit and `h.devicePixel`, which samples
// the store at a raw device coordinate and applies no map of its own.
//
// EACH SHAPE IS A WINDOW OF ITS OWN. A device pixel ratio belongs to a browser
// context rather than to a page, so `createHarness` opens one per shape and the
// build meets each as a fresh page — which is also the state the requirement is
// about.

import { afterEach, it } from "vitest";
import {
  assertCloseTo,
  assertGreaterThanOrEqual,
  assertNear,
  assertNotNull,
  assertTrue,
} from "../assert";
import {
  fitViewport,
  toDevice,
  type Pixel,
  type Viewport,
} from "../case-harness/index";
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
  type Rgb,
} from "../harness";
import type { Point } from "./read";

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

/** The stage, as `fitViewport` wants it. */
const STAGE = { width: STAGE_W, height: STAGE_H } as const;

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

/**
 * How far, in CSS pixels, the composited stage may sit from the specification's
 * fit of it into the window, and how far a store's side may sit from the element's
 * side at the ratio.
 *
 * One pixel: the layout engine places an element to a fraction of a pixel and a
 * store's side is a whole number, so a rounding either way is not a stage
 * off-centre. A bar drawn a pixel wider than its twin is invisible; a stage a
 * tile off-centre or a store a quarter short is not, and both clear this by
 * orders of magnitude.
 */
const PLACEMENT_TOLERANCE = 1;

/**
 * How far the scale may sit from the uniform one, as a proportion.
 *
 * The element's box is read to a sixty-fourth of a CSS pixel at most, which over
 * a 1280-unit stage is a hundredth of that; a non-uniform or a wrong scale is
 * whole per cents away.
 */
const SCALE_TOLERANCE = 1e-4;

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

/** The canvas as the page lays it out, read before anything is driven. */
interface CanvasBox {
  /** The element's box in CSS pixels, relative to the window. */
  rect: { x: number; y: number; w: number; h: number };
  /** The backing store, in device pixels. */
  store: { w: number; h: number };
  /** The ratio the page reports. */
  dpr: number;
}

/**
 * The canvas the build draws on: the one with the largest store, which is the
 * rule the harness's own `surface()` picks by.
 */
async function readCanvasBox(h: Harness): Promise<CanvasBox> {
  return h.page.evaluate(() => {
    const canvases = Array.from(document.querySelectorAll("canvas"));
    const first = canvases[0];
    if (first === undefined) {
      throw new Error(
        "the page has no <canvas>, so the build drew nowhere — index.html " +
          "supplies one and the build is asked not to edit it (specs/overview.md)",
      );
    }
    let canvas = first;
    for (const other of canvases) {
      if (other.width * other.height > canvas.width * canvas.height)
        canvas = other;
    }
    const r = canvas.getBoundingClientRect();
    return {
      rect: { x: r.left, y: r.top, w: r.width, h: r.height },
      store: { w: canvas.width, h: canvas.height },
      dpr: window.devicePixelRatio,
    };
  });
}

/**
 * The device pixel inside the store under each logical point, mapped through the
 * fit of the stage INTO THE ELEMENT rather than into the window.
 */
async function readThrough(
  h: Harness,
  inner: Viewport,
  points: readonly Point[],
): Promise<Rgb[]> {
  const read: Rgb[] = [];
  for (const point of points) {
    const at = toDevice(inner, point.x, point.y);
    const [r, g, b]: Pixel = await h.devicePixel(at.x, at.y);
    read.push({ r, g, b });
  }
  return read;
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

    // 1. The element and its store, before anything is driven: the store is the
    // element's own on-screen size at the ratio.
    const box = await readCanvasBox(h);
    const { rect, store } = box;
    assertCloseTo(box.dpr, dpr, 6, `${label}: the ratio the page reports`);
    assertNear(
      store.w,
      rect.w * dpr,
      PLACEMENT_TOLERANCE,
      `${label}: the canvas's backing-store width, in device pixels, for an ` +
        `element laid out ${rect.w} CSS pixels wide at ${dpr}x`,
    );
    assertNear(
      store.h,
      rect.h * dpr,
      PLACEMENT_TOLERANCE,
      `${label}: the canvas's backing-store height, in device pixels, for an ` +
        `element laid out ${rect.h} CSS pixels tall at ${dpr}x`,
    );

    // 2. The fit the specification requires, composited: the stage fitted into
    // the element, and the element where the page laid it out, land exactly
    // where the stage fitted into the window would.
    const inner = fitViewport(rect.w, rect.h, dpr, STAGE);
    const uniform = Math.min(cssWidth / STAGE_W, cssHeight / STAGE_H);
    assertNear(
      inner.cssScale,
      uniform,
      uniform * SCALE_TOLERANCE,
      `${label}: one uniform scale, CSS pixels per logical unit, over the ` +
        `whole window (the element's box is ${rect.w}x${rect.h})`,
    );
    const stageX = rect.x + inner.cssOffsetX;
    const stageY = rect.y + inner.cssOffsetY;
    const stageW = STAGE_W * inner.cssScale;
    const stageH = STAGE_H * inner.cssScale;
    // The whole stage is inside the window on both axes.
    assertTrue(
      stageX >= -PLACEMENT_TOLERANCE &&
        stageX + stageW <= cssWidth + PLACEMENT_TOLERANCE,
      `${label}: the stage's width, scaled, inside the window; it spans ` +
        `x in [${stageX}, ${stageX + stageW}] of a ${cssWidth}-wide window`,
    );
    assertTrue(
      stageY >= -PLACEMENT_TOLERANCE &&
        stageY + stageH <= cssHeight + PLACEMENT_TOLERANCE,
      `${label}: the stage's height, scaled, inside the window; it spans ` +
        `y in [${stageY}, ${stageY + stageH}] of a ${cssHeight}-tall window`,
    );
    // The leftover is split evenly into two bars, and one axis is filled
    // exactly, so the letterboxing is on the other alone.
    const barX = (cssWidth - stageW) / 2;
    const barY = (cssHeight - stageH) / 2;
    assertNear(
      stageX,
      barX,
      PLACEMENT_TOLERANCE,
      `${label}: the stage's left edge, in CSS pixels from the window's, so the ` +
        "two bars either side are even",
    );
    assertNear(
      stageY,
      barY,
      PLACEMENT_TOLERANCE,
      `${label}: the stage's top edge, in CSS pixels from the window's, so the ` +
        "two bars above and below are even",
    );
    assertNear(
      Math.min(barX, barY),
      0,
      PLACEMENT_TOLERANCE,
      `${label}: one axis filled exactly, so the letterboxing is on one axis`,
    );
    // And all four edges of the stage are inside the store.
    for (const corner of [
      { name: "top-left", x: 0, y: 0 },
      { name: "top-right", x: STAGE_W, y: 0 },
      { name: "bottom-left", x: 0, y: STAGE_H },
      { name: "bottom-right", x: STAGE_W, y: STAGE_H },
    ]) {
      const at = toDevice(inner, corner.x, corner.y);
      assertTrue(
        at.x >= 0 && at.x <= store.w && at.y >= 0 && at.y <= store.h,
        `${label}: the stage's ${corner.name} corner lands inside the ` +
          `${store.w}x${store.h} backing store; it lands at (${at.x}, ${at.y})`,
      );
    }

    // 3. The picture: the floor is really drawn through that map, out to its own
    // four corners, and the panel's controls are all on screen.
    await startRun(h);
    const probes = CORNERS.flatMap((corner) => footprintProbes(corner));

    await h.advance(1);
    const before = await readThrough(h, inner, probes);
    await h.advance(1);
    const quiet = await readThrough(h, inner, probes);

    for (const corner of CORNERS)
      await poseTower(h, TYPE, corner.col, corner.row);
    await h.advance(1);
    if (cssWidth === 1600 && dpr === 1) {
      // The off-aspect shape is the one worth keeping: the whole stage fitted
      // inside a window it does not fill, with a bar either side, is what this
      // point is about and is invisible at the stage's own size.
      await captureStill(h, "fitted");
    }
    const standing = await readThrough(h, inner, probes);

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
    for (const { name, rect: control } of named) {
      assertNotNull(
        control,
        `${label}: the rectangle the panel reports for ${name}, which cannot ` +
          "be checked for fit until the panel reports one (specs/hud.md)",
      );
      if (control === null) continue;
      for (const point of [
        { x: control.x, y: control.y },
        { x: control.x + control.w, y: control.y + control.h },
      ]) {
        const at = toDevice(inner, point.x, point.y);
        assertTrue(
          at.x >= 0 && at.x <= store.w && at.y >= 0 && at.y <= store.h,
          `${label}: ${name}, which the panel reports at (${control.x}, ` +
            `${control.y}) ${control.w}x${control.h}, lands inside the ` +
            `${store.w}x${store.h} backing store; its corner lands at ` +
            `(${at.x}, ${at.y})`,
        );
      }
    }
  },
);
