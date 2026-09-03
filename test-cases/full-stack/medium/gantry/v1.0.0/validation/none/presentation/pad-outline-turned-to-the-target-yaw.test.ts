// presentation/pad-outline-turned-to-the-target-yaw — a pad's outline is turned
// to the target yaw.
//
// specs/world.md § Pads: "A load's target pose is drawn as its pad: a marked
// footprint on the ground or on an obstacle's top, showing the class outline at
// the target yaw." specs/overview.md § Visual design asks for the same thing from
// the player's side: "each pad's footprint and required yaw are marked so a site
// is readable before anything is built".
//
// THE LOAD IS A CONTAINER, because its class box is `4 x 2 x 2`
// (specs/world.md § Loads) and so its footprint is a rectangle rather than a
// square: four units along `x` and two along `z` at yaw `0`, and the other way
// round at yaw `90`, since "a positive yaw turns `+x` toward `+z`"
// (specs/world.md § The world frame). A crate's square footprint would look the
// same at both yaws and could decide nothing.
//
// THREE PICTURES, because "painted" is a comparison and not a colour. The pad is
// first put somewhere else entirely, giving a picture of the ground with no pad
// on it; then the target is set at yaw `0`, and then at yaw `90`, with the load's
// own body and the camera untouched throughout. A corner the outline reaches is a
// point that changed from the pad-free picture; a corner it does not reach is one
// that did not.
//
// THE FOUR CORNERS OF EACH TURN ARE THE READING. At yaw `0` the footprint's
// corners are `(±2, 0, 8 ± 1)`; at yaw `90` they are `(±1, 0, 8 ± 2)`. Each set
// lies a whole unit outside the other footprint, which is far more than any
// stroke width, so an outline that stood square at both yaws — or one that turned
// the wrong way — is told apart from one that turned with the target.
//
// The tolerances are the same as every pad reading in this category: three
// logical pixels of slack for a stroke of the build's own width where the outline
// should be, twice that where it may not reach.

import { afterEach, beforeEach, it } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { assertGreaterThan, assertTrue } from "../assert";
import { LOAD_CLASS_DIMENSIONS, STAGE_H, STAGE_W } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

const SITE = 0;

/** The load: the one class whose footprint is not square. */
const CLASS = "container";
const MASS = 90;
const START = { x: 10, y: 2, z: 0, yaw: 0 } as const;

/** Where the pad is asked for, and where it is parked for the bare picture. */
const TARGET = { x: 0, y: 2, z: 8 } as const;
const ELSEWHERE = { x: -10, y: 2, z: -6, yaw: 0 } as const;

/** How far two colours must stand apart, of the 441 the colour cube spans. */
const CHANGED = 50;
/** Slack on a point the outline is drawn at, in logical pixels. */
const ON_TOLERANCE = 3;
/** Slack on a point it may not reach, in logical pixels. */
const OFF_TOLERANCE = 6;

/** How many of a turn's four corners the outline has to reach. */
const MOST = 3;

interface Picture {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
interface At {
  x: number;
  y: number;
}

/** The page as it stands, composited: the 3D yard with the screen layer over it. */
async function picture(harness: Harness): Promise<Picture> {
  // One held frame first: the page is off its own paint clock (see
  // `paint-gate.js`), and a screenshot is the whole page rather than just the
  // canvas `advance` has already drawn.
  await harness.paintFrame();
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

it("turns the pad's outline to the target yaw", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.debug.addLoad(CLASS, MASS, START.x, START.y, START.z, START.yaw);

  // The corners of the class box's footprint at each yaw, on the ground under
  // the target position (specs/world.md § Loads: the box "extends half its
  // width and half its depth horizontally from the lift point, rotated by its
  // yaw").
  const size = LOAD_CLASS_DIMENSIONS[CLASS];
  const corners = (yaw: number): { where: string; x: number; z: number }[] => {
    const along = yaw === 0 ? size.x / 2 : size.z / 2;
    const across = yaw === 0 ? size.z / 2 : size.x / 2;
    const out: { where: string; x: number; z: number }[] = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        out.push({
          where: `(${TARGET.x + sx * along}, 0, ${TARGET.z + sz * across})`,
          x: TARGET.x + sx * along,
          z: TARGET.z + sz * across,
        });
      }
    }
    return out;
  };
  const square = corners(0);
  const turned = corners(90);

  const where = new Map<string, At>();
  for (const corner of [...square, ...turned]) {
    const at = await h.project(corner.x, 0, corner.z);
    assertTrue(
      at.visible,
      `the ground point ${corner.where} to be drawn on the stage at the start ` +
        "camera pose, so this point has a picture to read " +
        "(specs/instrumentation.md)",
    );
    where.set(corner.where, at);
  }

  // The ground with this load's pad nowhere near it.
  await h.debug.setLoadTarget(
    0,
    ELSEWHERE.x,
    ELSEWHERE.y,
    ELSEWHERE.z,
    ELSEWHERE.yaw,
  );
  await h.advance(1);
  const bare = await picture(h);

  await h.debug.setLoadTarget(0, TARGET.x, TARGET.y, TARGET.z, 0);
  await h.advance(1);
  const atZero = await picture(h);

  await h.debug.setLoadTarget(0, TARGET.x, TARGET.y, TARGET.z, 90);
  await h.advance(1);
  const atNinety = await picture(h);
  await h.capture("pad-yaw", "The same pad at yaw 0 and yaw 90");

  const reached = (shot: Picture, corner: { where: string }): boolean =>
    changeNear(bare, shot, where.get(corner.where)!, ON_TOLERANCE) > CHANGED;
  const clear = (shot: Picture, corner: { where: string }): boolean =>
    changeNear(bare, shot, where.get(corner.where)!, OFF_TOLERANCE) <= CHANGED;

  assertGreaterThan(
    square.filter((corner) => reached(atZero, corner)).length,
    MOST - 1,
    `the corners of the ${CLASS}'s footprint at yaw 0 — ` +
      `${square.map((corner) => corner.where).join(", ")} — that the pad is ` +
      "drawn at, out of 4, since a pad shows the class outline at the target " +
      "yaw (specs/world.md § Pads)",
  );
  assertGreaterThan(
    turned.filter((corner) => clear(atZero, corner)).length,
    3,
    `the corners of the ${CLASS}'s footprint at yaw 90 — ` +
      `${turned.map((corner) => corner.where).join(", ")} — that the pad at ` +
      "yaw 0 leaves unmarked, out of 4: a pad turned to a yaw of 0 reaches " +
      "only its own footprint (specs/world.md § Pads)",
  );

  assertGreaterThan(
    turned.filter((corner) => reached(atNinety, corner)).length,
    MOST - 1,
    `the corners of the ${CLASS}'s footprint at yaw 90 — ` +
      `${turned.map((corner) => corner.where).join(", ")} — that the pad is ` +
      "drawn at once the target asks for a quarter turn, out of 4 " +
      "(specs/world.md § Pads)",
  );
  assertGreaterThan(
    square.filter((corner) => clear(atNinety, corner)).length,
    3,
    `the corners of the ${CLASS}'s footprint at yaw 0 — ` +
      `${square.map((corner) => corner.where).join(", ")} — that the pad at ` +
      "yaw 90 leaves unmarked, out of 4: an outline that stood square would " +
      "reach them at both yaws (specs/world.md § Pads)",
  );
});
