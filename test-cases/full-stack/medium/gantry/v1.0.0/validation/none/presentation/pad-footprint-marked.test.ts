// presentation/pad-footprint-marked — a load's pad is drawn as a footprint at
// the target position.
//
// specs/world.md § Pads: "A load's target pose is drawn as its pad: a marked
// footprint on the ground or on an obstacle's top, showing the class outline at
// the target yaw." specs/overview.md § Visual design puts the same requirement on
// the yard's legibility: "Anchor points, each load's starting position, and each
// pad's footprint and required yaw are marked so a site is readable before
// anything is built."
//
// THE SCENARIO MOVES THE PAD RATHER THAN REMOVING THE LOAD. What a build draws a
// pad AS is entirely its own — an outline, a hatched patch, a decal — so the
// reading has to be a before and after. Taking the load away would take its body
// off the screen at the same time, and then a change at the target could be the
// load's own drawing rather than the pad's. `setLoadTarget` moves ONLY the pad
// (specs/instrumentation.md: "Sets the target pose of the load at `index`, which
// is the pad it must be set down on"), so the load stands exactly where it stood,
// the camera is untouched, and the one thing that differs between the two
// pictures is where the pad is.
//
// WHERE THE FOOTPRINT IS ON THE STAGE IS THE BUILD'S OWN ANSWER. The corners and
// edge midpoints of the crate's 2 x 2 footprint, centred under the target
// position on the ground, are put through `project` — "Where `(x, y, z)` is
// drawn, through the camera as it stands" — so this reads the picture where the
// build itself says those world points landed. A validator measuring against a
// camera of its own would be grading its own arithmetic.
//
// THE TOLERANCES. A point is read as a small disc rather than as one pixel: an
// outline is a stroke of the build's own width and a mathematical corner can fall
// between two of its pixels, so three logical pixels of slack is honest for
// "the footprint reaches here". The control points sit four units — a whole
// footprint's width — outside it, read with twice that slack, which is far more
// room than any stroke and still nowhere near the load itself.
//
// The picture is read off the page's own composited frame rather than off a
// canvas: an engineless build draws the yard through WebGL, and the frame is the
// only place the yard exists.

import { afterEach, beforeEach, it } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import {
  assertGreaterThan,
  assertLessThanOrEqual,
  assertTrue,
} from "../assert";
import { LOAD_CLASS_DIMENSIONS, STAGE_H, STAGE_W } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The site this runs on: its yard is emptied to nothing but the one load. */
const SITE = 0;

/** The load whose pad this point is about, and where it stands. */
const CLASS = "crate";
const MASS = 40;
const START = { x: 10, y: 2, z: 0, yaw: 0 } as const;

/** The pad the load is wanted on, and where the pad is moved to afterwards. */
const TARGET = { x: 0, y: 2, z: 10, yaw: 0 } as const;
const ELSEWHERE = { x: -8, y: 2, z: -6, yaw: 0 } as const;

/** How far two colours must stand apart, of the 441 the colour cube spans. */
const CHANGED = 50;

/** Slack on a point the footprint is drawn at, in logical pixels. */
const ON_TOLERANCE = 3;
/** Slack on a point it may not reach, in logical pixels. */
const OFF_TOLERANCE = 6;

/** How far outside the footprint the control points stand, in world units. */
const CLEAR = 4;

/**
 * How many of the eight outline points a footprint has to be drawn at.
 *
 * Not all eight: the footprint is "the class outline at the target yaw" and a
 * build is free to draw that outline dashed, or to break it at the midpoints of
 * its sides for the yaw marker the same sentence asks for, so two of the eight
 * points are given away. Six of eight still cannot be reached by anything but a
 * mark that follows the footprint's own square.
 */
const MOST = 6;

/** A picture of the page, RGBA, four bytes per pixel, row-major. */
interface Picture {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** A point on the logical stage. */
interface At {
  x: number;
  y: number;
}

/** The page as it stands, composited: the 3D yard with the screen layer over it. */
async function picture(harness: Harness): Promise<Picture> {
  const png = await harness.page.screenshot({ type: "png" });
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, image.width, image.height);
  return { width: image.width, height: image.height, data };
}

/** What is drawn at a logical stage position. */
function colorAt(shot: Picture, at: At): [number, number, number] {
  const x = Math.min(
    Math.max(Math.round((at.x / STAGE_W) * shot.width), 0),
    shot.width - 1,
  );
  const y = Math.min(
    Math.max(Math.round((at.y / STAGE_H) * shot.height), 0),
    shot.height - 1,
  );
  const i = (y * shot.width + x) * 4;
  return [shot.data[i]!, shot.data[i + 1]!, shot.data[i + 2]!];
}

/** How far two colours stand apart. */
function apart(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
}

/** The furthest two pictures stand apart anywhere within `radius` of a point. */
function changeNear(a: Picture, b: Picture, at: At, radius: number): number {
  let most = 0;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const point = { x: at.x + dx, y: at.y + dy };
      most = Math.max(most, apart(colorAt(a, point), colorAt(b, point)));
    }
  }
  return most;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("marks the load's footprint on the ground at its target position", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.debug.addLoad(CLASS, MASS, START.x, START.y, START.z, START.yaw);
  await h.debug.setLoadTarget(0, TARGET.x, TARGET.y, TARGET.z, TARGET.yaw);
  await h.advance(1);
  await h.capture("pad", "The pad marked on the ground");

  // The footprint: the class's 2 x 2 box at yaw 0, on the ground under the
  // target position (specs/world.md — "Every load pose in this specification is
  // the pose of the load's lift point", and the box "extends half its width and
  // half its depth horizontally from the lift point"). Its four corners and the
  // midpoints of its four sides.
  const size = LOAD_CLASS_DIMENSIONS[CLASS];
  const outline: { where: string; x: number; z: number }[] = [];
  for (const dx of [-1, 0, 1]) {
    for (const dz of [-1, 0, 1]) {
      if (dx === 0 && dz === 0) continue;
      outline.push({
        where: `(${dx}, ${dz}) of the footprint`,
        x: TARGET.x + (dx * size.x) / 2,
        z: TARGET.z + (dz * size.z) / 2,
      });
    }
  }
  const clear = [
    { where: `${CLEAR} units short of it`, x: TARGET.x, z: TARGET.z - CLEAR },
    { where: `${CLEAR} units past it`, x: TARGET.x, z: TARGET.z + CLEAR },
    { where: `${CLEAR} units to one side`, x: TARGET.x + CLEAR, z: TARGET.z },
    { where: `${CLEAR} units to the other`, x: TARGET.x - CLEAR, z: TARGET.z },
  ];

  const where = new Map<string, At>();
  for (const point of [...outline, ...clear]) {
    const at = await h.project(point.x, 0, point.z);
    assertTrue(
      at.visible,
      `the ground point (${point.x}, 0, ${point.z}), ${point.where}, to be ` +
        "drawn on the stage at the start camera pose, so this point has a " +
        "picture to read (specs/instrumentation.md)",
    );
    where.set(point.where, at);
  }

  const before = await picture(h);
  // The pad, and only the pad, moves: the load stands where it stood.
  await h.debug.setLoadTarget(
    0,
    ELSEWHERE.x,
    ELSEWHERE.y,
    ELSEWHERE.z,
    ELSEWHERE.yaw,
  );
  await h.advance(1);
  const after = await picture(h);

  const missing = outline.filter(
    (point) =>
      changeNear(before, after, where.get(point.where)!, ON_TOLERANCE) <=
      CHANGED,
  );
  assertGreaterThan(
    outline.length - missing.length,
    MOST - 1,
    "the points of the crate's footprint on the ground under " +
      `(${TARGET.x}, ${TARGET.y}, ${TARGET.z}) that the pad is drawn at, out ` +
      `of ${outline.length}, since a load's target pose is drawn as a marked ` +
      "footprint there (specs/world.md § Pads) — unmarked: " +
      `${missing.map((point) => point.where).join(", ")}`,
  );

  for (const point of clear) {
    assertLessThanOrEqual(
      changeNear(before, after, where.get(point.where)!, OFF_TOLERANCE),
      CHANGED,
      `the ground ${point.where}, which moving the pad may not change ` +
        "because a pad is a footprint at the target position rather than a " +
        "mark spread over the yard (specs/world.md § Pads)",
    );
  }
});
