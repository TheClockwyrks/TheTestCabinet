// presentation/load-starts-marked — each load is drawn where the site starts it.
//
// specs/overview.md, "Visual design", the row for anchors and pads: "Anchor
// points, each load's starting position, and each pad's footprint and required
// yaw are marked so a site is readable before anything is built."
// specs/ui.md, "Build": `build` "shows the yard through the camera: the ground,
// the lattice and envelope aids, the anchors, the obstacles, the loads at their
// starting poses, the pads, and the structure as built". specs/world.md fixes
// what a load occupies: "Every load pose in this specification is the pose of the
// load's lift point: the center of its top face... The load's box extends half
// its width and half its depth horizontally from the lift point, rotated by its
// yaw, and its full height below it", with `crate` `2 x 2 x 2`.
//
// SO THE READING IS WHERE THE BOX IS. The eight corners of the class box at the
// authored starting pose are put through `project` — "Where `(x, y, z)` is drawn,
// through the camera as it stands" (specs/instrumentation.md) — and what the
// point asks is that adding the load paints inside the extent the build itself
// says that box occupies. A validator that projected through a camera of its own
// would be grading its own arithmetic.
//
// THE READING IS A BEFORE AND AFTER, because what a build draws a crate as is
// its own produced model (specs/assets.md). The yard is emptied to nothing, the
// frame is photographed, one load is posed with the camera and the pointer
// untouched, and the frame is photographed again.
//
// THE CONTROL IS THE SAME BOX SOMEWHERE ELSE IN THE YARD — the extent the load
// would occupy eight units along `+z` of where it was actually put. It is what
// says the load is drawn at ITS starting pose rather than wherever the build
// felt like putting a crate. The load's pad is authored far from both extents,
// so neither reading is the pad's marking.

import { afterEach, beforeEach, it } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import {
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
  assertTrue,
} from "../assert";
import { LOAD_CLASS_DIMENSIONS, STAGE_H, STAGE_W } from "../constants";
import {
  addOneLoad,
  clearAll,
  createHarness,
  openSite,
  type Harness,
  type LoadPose,
} from "../harness";

const SITE = 0;

/** The one load: a crate, at rest on the ground, out in the clear. */
const CLASS = "crate" as const;
const MASS = 40;
const START: LoadPose = { x: 8, y: 2, z: -4, yaw: 0 };

/** Where it is wanted: far from the extent this point reads, so is its pad. */
const TARGET: LoadPose = { x: -6, y: 2, z: 6, yaw: 0 };

/** The extent that must stand unchanged: the same box, eight units along `+z`. */
const ELSEWHERE: LoadPose = { x: 8, y: 2, z: 4, yaw: 0 };

/** The grid read over the middle of a box's projected extent. */
const GRID = 5;

/** How much of the projected extent the grid spans, either way from its middle. */
const INSET = 0.4;

/**
 * How many of those points the drawn load must reach: a majority.
 *
 * Not every one of them. A build picks its own palette (specs/overview.md) and
 * is free to draw a crate in a colour the yard floor behind it is close to, so
 * some of a genuinely drawn box parts from the empty frame by less than a
 * reading can call a drawing. What no build can do is paint a majority of the
 * box's middle while drawing the load somewhere else — and the extent this
 * check reads elsewhere in the yard has to part at NO point at all, which is
 * the other side of the same claim.
 */
const NEEDED = 13;

/** A change in the picture that is a thing being drawn, out of 441. */
const DREW = 50;

/** A difference small enough to be anti-aliasing rather than a drawing. */
const UNCHANGED = 25;

/* -------------------------------------------------------------------------- */
/* Reading the picture                                                        */
/* -------------------------------------------------------------------------- */
//
// An engineless build draws the yard through WebGL, so nothing here reads pixels
// off a 2D context: what a check reads is the page's own composited frame, taken
// with `page.screenshot` — the same picture `h.capture` writes as the review
// item's evidence. The PNG is decoded HERE, with `@napi-rs/canvas`, rather than
// handed back to the page: a frame is two million pixels and sending it back out
// of the browser costs several megabytes of base64 over the debugging channel,
// which is time this point spends on nothing it reads.
//
// A point is addressed in LOGICAL STAGE UNITS, the units `project` answers in
// and the units `specs/overview.md` lays the stage out in, and the canvas's own
// box on the page is what turns one into the other: the stage is fitted into it
// at one uniform scale, centred, exactly as that file states.

/** A colour read off the frame, each channel 0-255. */
type Rgb = readonly [number, number, number];

/** One composited frame, read at logical stage points. */
interface Frame {
  at(x: number, y: number): Rgb;
}

/** How far apart two colours are, on the 0-441 (`sqrt(3) * 255`) scale. */
function apart(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** The picture on screen right now, as a colour lookup in stage units. */
async function readFrame(h: Harness): Promise<Frame> {
  const box = (await h.page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (canvas === null) return null;
    const at = canvas.getBoundingClientRect();
    return { x: at.x, y: at.y, width: at.width, height: at.height };
  })) as { x: number; y: number; width: number; height: number } | null;
  assertTrue(
    box !== null,
    "a <canvas> on the page for the build to draw the yard in",
  );
  // One held frame first: the page is off its own paint clock (see
  // `paint-gate.js`), and a screenshot is the whole page rather than just the
  // canvas `advance` has already drawn.
  await h.paintFrame();
  const image = await loadImage(await h.page.screenshot({ type: "png" }));
  const surface = createCanvas(image.width, image.height);
  const context = surface.getContext("2d");
  context.drawImage(image, 0, 0);
  const decoded = { width: image.width, height: image.height };
  const bytes = context.getImageData(0, 0, image.width, image.height).data;
  const fit = box as { x: number; y: number; width: number; height: number };
  const scale = Math.min(fit.width / STAGE_W, fit.height / STAGE_H);
  const originX = fit.x + (fit.width - STAGE_W * scale) / 2;
  const originY = fit.y + (fit.height - STAGE_H * scale) / 2;
  return {
    at(x, y) {
      const px = Math.round(originX + x * scale);
      const py = Math.round(originY + y * scale);
      if (px < 0 || py < 0 || px >= decoded.width || py >= decoded.height) {
        return [0, 0, 0];
      }
      const at = (py * decoded.width + px) * 4;
      return [bytes[at]!, bytes[at + 1]!, bytes[at + 2]!];
    },
  };
}
/**
 * The points read over the middle of the extent a `crate` at `pose` occupies.
 *
 * The eight corners of the class box (specs/world.md) go through the build's own
 * projection; the grid covers the middle half of their bounding box, which is
 * comfortably inside a body that fills the box rather than out on the silhouette
 * where a model's edge and the ground behind it meet.
 */
async function extent(
  h: Harness,
  pose: LoadPose,
): Promise<{ x: number; y: number }[]> {
  const size = LOAD_CLASS_DIMENSIONS[CLASS];
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const dx of [-size.x / 2, size.x / 2]) {
    for (const dy of [-size.y, 0]) {
      for (const dz of [-size.z / 2, size.z / 2]) {
        const at = await h.project(pose.x + dx, pose.y + dy, pose.z + dz);
        assertTrue(
          at.visible,
          `the corner (${pose.x + dx}, ${pose.y + dy}, ${pose.z + dz}) of the ` +
            "box to be drawn on the stage at the start camera pose " +
            "(specs/instrumentation.md)",
        );
        left = Math.min(left, at.x);
        right = Math.max(right, at.x);
        top = Math.min(top, at.y);
        bottom = Math.max(bottom, at.y);
      }
    }
  }
  // The grid is centred on the box's own middle — the point half a height below
  // the lift point (specs/world.md) — and spans a third of the projected extent
  // either way, which is comfortably inside a body that fills the box rather
  // than out on the silhouette where the model's edge meets the ground behind.
  const middle = await h.project(pose.x, pose.y - size.y / 2, pose.z);
  const halfWidth = ((right - left) / 2) * INSET;
  const halfHeight = ((bottom - top) / 2) * INSET;
  const points: { x: number; y: number }[] = [];
  for (let row = 0; row < GRID; row += 1) {
    for (let column = 0; column < GRID; column += 1) {
      const u = -1 + (2 * (column + 0.5)) / GRID;
      const v = -1 + (2 * (row + 0.5)) / GRID;
      const point = {
        x: middle.x + halfWidth * u,
        y: middle.y + halfHeight * v,
      };
      assertTrue(
        point.x >= 0 && point.x < STAGE_W && point.y >= 0 && point.y < STAGE_H,
        "every point read over a load's extent to lie on the stage",
      );
      points.push(point);
    }
  }
  return points;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a waiting load at the starting pose the site gives it", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.advance(1);
  assertLessThanOrEqual(
    (await h.snapshot()).site.loads.length,
    0,
    "the loads standing in the emptied yard, before the one this point poses",
  );

  const started = await extent(h, START);
  const other = await extent(h, ELSEWHERE);
  const empty = await readFrame(h);

  await addOneLoad(h, CLASS, MASS, START, TARGET);
  await h.advance(1);

  const posed = await h.snapshot();
  assertTrue(
    posed.site.loads.length === 1,
    "the one load this point poses to stand in the yard (specs/world.md)",
  );
  const authored = posed.site.loads[0]!;
  assertTrue(
    authored.from.x === START.x &&
      authored.from.y === START.y &&
      authored.from.z === START.z,
    `the load's authored starting pose to be (${START.x}, ${START.y}, ` +
      `${START.z}), which is what this point reads the picture against`,
  );

  const laden = await readFrame(h);
  await h.capture("loads", "A waiting load drawn at its starting pose");

  const painted = started.filter(
    (point) =>
      apart(empty.at(point.x, point.y), laden.at(point.x, point.y)) > DREW,
  ).length;
  assertGreaterThanOrEqual(
    painted,
    NEEDED,
    `${NEEDED} of the ${GRID * GRID} points read over the extent the load's ` +
      `box occupies at (${START.x}, ${START.y}, ${START.z}) to be painted ` +
      "when the load is posed, since the build screen shows the loads at " +
      "their starting poses (specs/ui.md)",
  );

  const spilled = other.filter(
    (point) =>
      apart(empty.at(point.x, point.y), laden.at(point.x, point.y)) > UNCHANGED,
  ).length;
  assertLessThanOrEqual(
    spilled,
    0,
    `the extent the same box would occupy at (${ELSEWHERE.x}, ` +
      `${ELSEWHERE.y}, ${ELSEWHERE.z}) to stand unchanged, since a waiting ` +
      "load is drawn at its own starting pose (specs/ui.md); it changed at " +
      `${spilled} of the ${GRID * GRID} points read there`,
  );
});
