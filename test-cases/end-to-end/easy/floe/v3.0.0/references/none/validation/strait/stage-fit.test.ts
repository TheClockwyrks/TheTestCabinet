// strait/stage-fit — the whole 1280 x 720 stage stays visible, fitted and
// centred, at every window shape and pixel density.
//
// UNDER AN ENGINE THIS IS THE ENGINE'S WORK; HERE IT IS THE BUILD'S. That is the
// difference this suite is written around. `specs/overview.md` fixes the fit an
// engineless build derives for itself — "the uniform scale that preserves the
// aspect ratio, the letterboxed centering, and the device pixel ratio", so that
// "the complete stage is therefore on screen at every window size, on load and at
// any pixel density" — and there is no viewport to ask the build for. Asking it
// what it derived would be asking it to grade itself, so the harness computes the
// fit the SPECIFICATION requires (`fitViewport`) and every reading below is taken
// against that.
//
// THREE READINGS, OVER SIX WINDOWS: three window sizes at each of two pixel
// densities, which is what the item names.
//
//   1. ARITHMETIC THE BUILD CANNOT ARGUE WITH. The canvas's backing store has to
//      be the window at its device pixel ratio. It is read BEFORE anything is
//      posed or driven, because the item is about the state a build reaches on
//      load, before any input.
//   2. THE FIT ITSELF. The whole stage inside the surface on both axes at one
//      uniform scale, the leftover split evenly into two bars, one axis filled
//      exactly. This is a property of the required fit rather than of the build,
//      and it is stated here so the coordinates the third reading is expressed in
//      are visible beside it.
//   3. THE PICTURE. The build really drew into that map: the critter posed on
//      each of the strait's FOUR EXTREME TILES is read at that tile's own logical
//      centre, mapped through the specified fit, and what is there must have
//      CHANGED. A build that scaled non-uniformly, that cropped, that anchored the
//      stage to a corner, or that drew in device pixels and ignored the ratio
//      leaves the four points exactly as they were.
//
// WHY THE FOUR CORNERS, AND WHY THE READING IS THE BUILD AGAINST ITSELF. A wrong
// fit displaces a point by more the further it is from the centre of the surface,
// so the corners are where a wrong fit shows and the middle is where it hides;
// `specs/strait.md`'s grid puts the corner tiles at `(0, 0)`, `(39, 0)`, `(0, 19)`
// and `(39, 19)`, which are the four corners of the stage's whole play area. And
// each corner is read TWICE — once bare and once with the critter on it — so what
// is compared is the same build's own two pictures, and what is asserted is that
// they differ at all. Nothing here fixes a colour and nothing measures how far
// apart the two readings are; how the critter looks against the band under it is
// appearance, which the reviewer judges.
//
// A DRAW CALL CANNOT ANSWER THIS. A blit's coordinates are logical units, so a
// build that scaled non-uniformly, cropped, anchored to a corner or ignored the
// device pixel ratio submits exactly the same draw calls as one that fitted the
// stage correctly. `strait/tiles-drawn-on-the-map` reads those calls, on one
// surface size; only the surface itself says where they landed.
//
// AND A FOURTH READING, THE BARS THEMSELVES, WHICH IS "THE BUILD DREW NOTHING
// HERE". `specs/overview.md` fixes what the letterbox carries: "The letterbox
// bars around the stage carry the stage's background color." A build that
// stretched its picture into the bars, cropped the stage against them, or painted
// the strait past the stage's edge puts the GAME there instead — so the bars are
// read on two frames of a live crossing whose lanes have moved between them, and
// every bar point must be exactly what it was. A build whose picture reaches the
// letterbox moves those pixels when the lanes move; a build whose letterbox is
// its own background, whatever colour that is, does not. No colour is named and
// none is compared: the specification leaves the background to the build. The
// surfaces of the stage's own aspect leave no bar and are read on the readings
// above alone.
//
// EACH SHAPE IS A WINDOW OF ITS OWN. A device pixel ratio belongs to a browser
// context rather than to a page, so `createHarness` opens one per shape and the
// build meets each as a fresh page — which is also the state the item is about.

import { afterEach, it } from "vitest";
import {
  assertCloseTo,
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
  assertTrue,
} from "../assert";
import { COLS, ICE_TOP, ROWS, STAGE_H, STAGE_W } from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  itemsOnRow,
  sampleTile,
  startCrossing,
  startRunFromTitle,
  ticksFor,
  type Harness,
  type Rgb,
} from "../harness";

/**
 * How long the crossing is left running between the two letterbox readings.
 *
 * Half a second. Every lane `specs/ice.md` and `specs/water.md` tabulate runs at
 * a tile a second or more, so half a second moves every one of them by more than
 * half a tile — plenty for a build whose picture reaches the letterbox to show
 * it, and short enough to keep six surfaces inside the suite's budget.
 */
const LANE_DRIFT_SECONDS = 0.5;

/** Every letterbox point, as the bytes the build painted into them. */
async function readBars(
  h: Harness,
  bars: readonly { x: number; y: number }[],
): Promise<number[][]> {
  const read: number[][] = [];
  for (const bar of bars) {
    const [r, g, b] = await h.devicePixel(bar.x, bar.y);
    read.push([r, g, b]);
  }
  return read;
}

/**
 * The three window sizes at the two pixel densities the item names.
 *
 * The stage's own size, one wider than it, and one taller than it: the three
 * shapes the letterbox can take — none, bars either side, bars above and below —
 * each met at one device pixel per CSS pixel and at two.
 */
const SURFACES = [
  {
    name: "the stage's own size",
    cssWidth: STAGE_W,
    cssHeight: STAGE_H,
    dpr: 1,
  },
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
    name: "the stage's own size at twice the pixel ratio",
    cssWidth: STAGE_W,
    cssHeight: STAGE_H,
    dpr: 2,
  },
  {
    name: "a wider window at twice the pixel ratio",
    cssWidth: 800,
    cssHeight: 450,
    dpr: 2,
  },
  {
    name: "a taller window at twice the pixel ratio",
    cssWidth: 640,
    cssHeight: 480,
    dpr: 2,
  },
];

/**
 * How wide a letterbox has to be before its pixels are read, in device pixels.
 *
 * Four. A surface of the stage's own aspect leaves no bar at all, and the fit's
 * rounding to whole device pixels can leave a sliver of one on a surface that is
 * a fraction off — reading a bar a pixel or two wide would be reading that
 * rounding, and its antialiased edge, rather than the requirement.
 */
const BAR_MIN = 4;

/** Where along a bar it is sampled, as fractions of its width and its length. */
const BAR_FRACTIONS = [0.25, 0.5, 0.75] as const;

/** Device points of every letterbox bar the fit left, or none where it left none. */
function barPoints(
  offsetX: number,
  offsetY: number,
  deviceWidth: number,
  deviceHeight: number,
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  for (const across of BAR_FRACTIONS) {
    for (const along of BAR_FRACTIONS) {
      if (offsetX >= BAR_MIN) {
        const inset = Math.floor(offsetX * across);
        const y = Math.floor(deviceHeight * along);
        points.push({ x: inset, y });
        points.push({ x: deviceWidth - 1 - inset, y });
      }
      if (offsetY >= BAR_MIN) {
        const inset = Math.floor(offsetY * across);
        const x = Math.floor(deviceWidth * along);
        points.push({ x, y: inset });
        points.push({ x, y: deviceHeight - 1 - inset });
      }
    }
  }
  return points;
}

/** The four extreme tiles of the strait: the corners of the whole play area. */
const CORNERS = [
  { col: 0, row: 0, where: "the top-left tile" },
  { col: COLS - 1, row: 0, where: "the top-right tile" },
  { col: 0, row: ROWS - 1, where: "the bottom-left tile" },
  { col: COLS - 1, row: ROWS - 1, where: "the bottom-right tile" },
] as const;

let harnesses: Harness[] = [];

afterEach(async () => {
  for (const h of harnesses) await h.dispose();
  harnesses = [];
});

it.each(SURFACES)(
  "fits the whole stage into $name, centred, and draws into that map",
  async ({ cssWidth, cssHeight, dpr, name }) => {
    const h = await createHarness({ cssWidth, cssHeight, dpr });
    harnesses.push(h);

    // 1. The state the build reached on load, before anything was posed: the
    //    backing store is the window at the device pixel ratio.
    const store = await h.surface();
    assertCloseTo(store.dpr, dpr, 6, "the page's device pixel ratio");
    assertEqual(
      store.width,
      Math.round(cssWidth * dpr),
      "the canvas's backing store width, in device pixels",
    );
    assertEqual(
      store.height,
      Math.round(cssHeight * dpr),
      "the canvas's backing store height, in device pixels",
    );

    // 2. The fit the specification requires over a surface of exactly that
    //    shape, and the space every reading below is expressed in.
    const view = h.viewport();
    const uniform = Math.min(cssWidth / STAGE_W, cssHeight / STAGE_H) * dpr;
    assertEqual(view.width, STAGE_W, "the logical stage's width");
    assertEqual(view.height, STAGE_H, "the logical stage's height");
    assertCloseTo(view.scale, uniform, 9, "one uniform scale on both axes");
    assertLessThanOrEqual(
      STAGE_W * view.scale,
      store.width + 1e-6,
      "the whole stage across the surface",
    );
    assertLessThanOrEqual(
      STAGE_H * view.scale,
      store.height + 1e-6,
      "the whole stage down the surface",
    );
    assertCloseTo(
      view.offsetX * 2 + STAGE_W * view.scale,
      store.width,
      6,
      "the leftover across split evenly into two bars",
    );
    assertCloseTo(
      view.offsetY * 2 + STAGE_H * view.scale,
      store.height,
      6,
      "the leftover down split evenly into two bars",
    );
    assertCloseTo(
      Math.min(view.offsetX, view.offsetY),
      0,
      6,
      "one axis filled exactly, so the letterboxing is on the other alone",
    );

    // 3. The picture. An emptied, live strait with nothing on it, read at the
    //    four corner tiles; then the critter put on each corner in turn and the
    //    same four points read again.
    await startCrossing(h);
    await h.debug.removeCritter();
    await h.step();
    const bare: Rgb[] = [];
    for (const corner of CORNERS) {
      bare.push(await sampleTile(h, corner.col, corner.row));
    }

    for (const [index, corner] of CORNERS.entries()) {
      await h.debug.addCritter(corner.col, corner.row);
      await h.step();
      // The off-aspect shape is the one worth keeping: the whole stage fitted
      // inside a window it does not fill is what this item is about, and it is
      // invisible on a surface the size of the stage.
      if (name === "a window wider than the stage" && index === 0) {
        await captureStill(h, "fit");
      }
      const drawn = await sampleTile(h, corner.col, corner.row);
      assertGreaterThan(
        colorDistance(drawn, bare[index]),
        0,
        `${corner.where} of the strait, read at its own logical centre through ` +
          `the fit the specification requires: putting the critter on it ` +
          `changed what is drawn there (specs/overview.md)`,
      );
      await h.debug.removeCritter();
    }

    // 4. The bars, over a real run whose lanes are moving: whatever the build
    //    drew in the letterbox, the game moving must not have moved it.
    const bars = barPoints(
      view.offsetX,
      view.offsetY,
      store.width,
      store.height,
    );
    if (bars.length > 0) {
      await startRunFromTitle(h);
      await h.advance(1);
      const before = await readBars(h, bars);
      const movingRow = ICE_TOP;
      const beforeItems = itemsOnRow(await h.snapshot(), movingRow);
      await h.advance(ticksFor(LANE_DRIFT_SECONDS));
      const after = await readBars(h, bars);
      const afterItems = itemsOnRow(await h.snapshot(), movingRow);

      // The situation: the strait really was running between the two readings,
      // so a bar that did not move is a bar the game does not reach.
      assertTrue(
        beforeItems.length > 0 &&
          afterItems.some((item) =>
            beforeItems.some((was) => was.id === item.id && was.x !== item.x),
          ),
        `the lanes on row ${movingRow} to have moved between the two ` +
          `letterbox readings (specs/ice.md)`,
      );

      assertDeepEqual(
        after,
        before,
        `the letterbox pixels across ${LANE_DRIFT_SECONDS} s of a running ` +
          `crossing — the bars around the stage carry the stage's background ` +
          `colour and nothing the game draws (specs/overview.md)`,
      );
    }

    // Nothing the page threw or logged as an error while this harness drove it.
    assertDeepEqual(h.pageErrors, []);
  },
);
