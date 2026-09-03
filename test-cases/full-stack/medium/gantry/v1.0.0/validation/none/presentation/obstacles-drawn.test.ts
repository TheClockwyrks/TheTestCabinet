// presentation/obstacles-drawn — the build screen draws each obstacle as the box
// it occupies.
//
// specs/ui.md § Build: "`build` shows the yard through the camera: the ground,
// the lattice and envelope aids, the anchors, THE OBSTACLES, the loads at their
// starting poses, the pads, and the structure as built". specs/world.md §
// Obstacles says what an obstacle is: "a fixed axis-aligned box, stated as a
// minimum corner and a size per axis" — so drawing one is drawing that box where
// the camera puts it, which is what the player has to read to know what the crane
// and the load must clear.
//
// THE READING IS A BEFORE AND AFTER, because what a build draws a box AS is its
// own — a solid, a wireframe, a hatched slab, a hazard-striped block. What is
// fixed is that a box standing in the yard is drawn where the box is. So the yard
// is emptied to nothing at all, the frame is photographed, one obstacle is posed
// with the camera untouched, and the frame is photographed again.
//
// THE POINTS READ ARE THE FACES AND EDGES THE CAMERA CAN SEE. At the start camera
// pose the camera stands off `+x` and `+z` and looks down, so the box's top face
// and its `+x` and `+z` faces are toward it, and the three vertical edges those
// faces meet at are its silhouette on that side. A build that drew a marker at
// the box's centre, or a flat patch on the ground under it, reaches none of them.
// Where each of those points lands on the stage is the build's own answer, through
// `project` — "Where `(x, y, z)` is drawn, through the camera as it stands".
//
// THE CONTROL POINTS stand twenty units away across the yard, which no drawing of
// a box four units wide can reach, so a build that repainted the whole scene is
// told from one that drew a box.

import { afterEach, beforeEach, it } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import {
  assertEqual,
  assertLessThanOrEqual,
  assertGreaterThan,
  assertTrue,
} from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

const SITE = 0;

/** The obstacle: a box standing clear of the anchors and well inside the frame. */
const MIN = { x: 4, y: 0, z: 4 } as const;
const SIZE = { x: 4, y: 6, z: 4 } as const;

/** How far two colours must stand apart, of the 441 the colour cube spans. */
const CHANGED = 50;
/** Slack on a point the box is drawn at, in logical pixels. */
const ON_TOLERANCE = 3;
/** Slack on a control point, in logical pixels. */
const OFF_TOLERANCE = 10;

/** How many of the six points on the box's visible faces must be drawn at. */
const MOST = 5;

interface Picture {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
interface At {
  x: number;
  y: number;
}

async function picture(harness: Harness): Promise<Picture> {
  const png = await harness.page.screenshot({ type: "png" });
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, image.width, image.height);
  return { width: image.width, height: image.height, data };
}

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

function apart(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
}

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

it("draws a posed obstacle as the box its corner and size give it", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.advance(1);

  const empty = await h.snapshot();
  assertEqual(empty.screen, "build", "the screen opening a site shows");
  assertEqual(
    empty.site.obstacles.length,
    0,
    "the obstacles standing in the emptied yard, before the one this point " +
      "poses",
  );

  const max = {
    x: MIN.x + SIZE.x,
    y: MIN.y + SIZE.y,
    z: MIN.z + SIZE.z,
  };
  const mid = {
    x: MIN.x + SIZE.x / 2,
    y: MIN.y + SIZE.y / 2,
    z: MIN.z + SIZE.z / 2,
  };
  // The three faces the start camera pose sees, and the three vertical edges
  // they meet at.
  const onBox = [
    { where: "the top face's centre", x: mid.x, y: max.y, z: mid.z },
    { where: "the +x face's centre", x: max.x, y: mid.y, z: mid.z },
    { where: "the +z face's centre", x: mid.x, y: mid.y, z: max.z },
    { where: "the near vertical edge", x: max.x, y: mid.y, z: max.z },
    { where: "the +x face's far edge", x: max.x, y: mid.y, z: MIN.z },
    { where: "the +z face's far edge", x: MIN.x, y: mid.y, z: max.z },
  ];
  const away = [
    { where: "the ground 20 units away", x: MIN.x - 14, y: 0, z: MIN.z - 14 },
    { where: "the ground across the yard", x: mid.x - 6, y: 0, z: MIN.z - 12 },
  ];

  const where = new Map<string, At>();
  for (const point of [...onBox, ...away]) {
    const at = await h.project(point.x, point.y, point.z);
    assertTrue(
      at.visible,
      `${point.where}, at (${point.x}, ${point.y}, ${point.z}), to be drawn ` +
        "on the stage at the start camera pose, so this point has a picture " +
        "to read (specs/instrumentation.md)",
    );
    where.set(point.where, at);
  }

  const before = await picture(h);
  await h.debug.addObstacle(MIN.x, MIN.y, MIN.z, SIZE.x, SIZE.y, SIZE.z);
  await h.advance(1);
  const after = await picture(h);
  await h.capture("obstacle", "The yard with one obstacle standing in it");

  assertEqual(
    (await h.snapshot()).site.obstacles.length,
    1,
    "the obstacles standing in the yard once one is posed",
  );

  const missed = onBox.filter(
    (point) =>
      changeNear(before, after, where.get(point.where)!, ON_TOLERANCE) <=
      CHANGED,
  );
  assertGreaterThan(
    onBox.length - missed.length,
    MOST - 1,
    `the points on the visible faces and edges of the box (${MIN.x}, ` +
      `${MIN.y}, ${MIN.z}) + (${SIZE.x}, ${SIZE.y}, ${SIZE.z}) that posing ` +
      `the obstacle draws over, out of ${onBox.length}, since the build ` +
      "screen shows the yard's obstacles and an obstacle is the box its " +
      "minimum corner and size give it (specs/ui.md § Build, specs/world.md " +
      `§ Obstacles) — untouched: ${missed.map((p) => p.where).join(", ")}`,
  );

  for (const point of away) {
    assertLessThanOrEqual(
      changeNear(before, after, where.get(point.where)!, OFF_TOLERANCE),
      CHANGED,
      `${point.where}, which posing an obstacle over there may not change ` +
        "because an obstacle is drawn as the box it occupies (specs/ui.md " +
        "§ Build)",
    );
  }
});
