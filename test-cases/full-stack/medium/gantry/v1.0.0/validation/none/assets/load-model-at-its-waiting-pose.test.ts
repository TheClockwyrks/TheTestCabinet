// assets/load-model-at-its-waiting-pose — a waiting load is drawn where the site
// starts it.
//
// specs/assets.md, "The models": "The game draws each model wherever its subject
// is: … and each load at its pose, waiting, hanging, or placed."
// specs/world.md, "Loads": "Every load pose in this specification is the pose of
// the load's lift point: the center of its top face. … The load's box extends
// half its width and half its depth horizontally from the lift point, rotated by
// its yaw, and its full height below it."
//
// WHAT IS READ, AND WHY IT IS A BEFORE AND AFTER. How a build draws a crate is
// the build's — its own sculpt, its own colors, its own lighting. What
// specs/assets.md fixes is WHERE it is drawn. So the yard is emptied to nothing,
// the frame is photographed, exactly one load is added at a known starting pose
// with the camera untouched, and the frame is photographed again: the picture
// inside the load's own box has to change, and the picture outside it may not.
//
// WHERE THE BOX IS ON THE STAGE IS THE BUILD'S OWN ANSWER. The eight corners of
// the class box at the starting pose go through `project`, which
// specs/instrumentation.md defines as "Where `(x, y, z)` is drawn, through the
// camera as it stands" — so what this point holds the drawing to is the extent
// the build itself says that box occupies, not a camera of a validator's own.
//
// THE MARGIN IS AN HONEST TOLERANCE. specs/assets.md says the load models "fill
// their class boxes" and that the figures are "the intent, not a tolerance", and
// a build draws the pad's footprint and its yaw mark under the load as well. So
// a few logical pixels of drawing fall outside the mathematical hull; the margin
// is a quarter of the box's own drawn size, which is room for that and still far
// short of anywhere else in the yard.
//
// AND THE STAGE THAT MAY NOT CHANGE IS THE YARD AROUND THE LOAD, not the whole
// frame. specs/ui.md fixes what the build screen's readouts show, but a build is
// free to put more beside them — a count of the yard's loads, say — and a
// validator that held the whole frame still would fail such a build for a
// flourish the specification neither asks for nor forbids. What it cannot be
// free about is WHERE the load itself is drawn, so the ring of yard around the
// load's own box is what is held still: a load drawn beside its starting pose
// rather than at it lands in that ring.
//
// THE TARGET IS LEFT WHERE `addLoad` PUTS IT — equal to the starting pose
// (specs/instrumentation.md) — so the pad is drawn under the load rather than
// somewhere else, and the one change this point measures stays one change.
//
// The picture is compared as PNG bytes off the page rather than as pixels off a
// canvas: an engineless build draws the yard through WebGL, so the only place
// the yard and the screen layer exist together is the page's own composited
// frame.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { LOAD_CLASS_DIMENSIONS, STAGE_H, STAGE_W } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  type Harness,
  type LoadPose,
} from "../harness";

const SITE = 0;

/** The load this point poses: one crate, well clear of the site's anchors. */
const CLASS = "crate" as const;
const MASS = 40;
const START: LoadPose = { x: 7, y: 2, z: -3, yaw: 0 };

/** Slack around the projected hull, as a share of the box's own drawn size. */
const MARGIN_SHARE = 0.25;

/** How far past that slack the yard is held still, in the same units. */
const RING_SHARE = 2;

/** A rectangle of the stage, in logical units. */
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a waiting load inside its class box at its starting pose", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.advance(1);

  const empty = await h.snapshot();
  assertEqual(empty.screen, "build", "the screen opening a site shows");
  assertEqual(
    empty.site.loads.length,
    0,
    "the loads standing in the emptied yard, before the one this point poses",
  );

  // The class box at the starting pose (specs/world.md): half its width and half
  // its depth from the lift point, turned by its yaw, and its full height below.
  const size = LOAD_CLASS_DIMENSIONS[CLASS];
  const radians = (START.yaw * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const dx of [-size.x / 2, size.x / 2]) {
    for (const dz of [-size.z / 2, size.z / 2]) {
      for (const dy of [-size.y, 0]) {
        const at = await h.project(
          START.x + dx * cos - dz * sin,
          START.y + dy,
          START.z + dx * sin + dz * cos,
        );
        assertTrue(
          at.visible,
          "every corner of the load's class box to be drawn on the stage at " +
            "the start camera pose, so this point has a picture to read " +
            "(specs/instrumentation.md)",
        );
        left = Math.min(left, at.x);
        right = Math.max(right, at.x);
        top = Math.min(top, at.y);
        bottom = Math.max(bottom, at.y);
      }
    }
  }

  const inside: Rect = {
    x: Math.max(0, left),
    y: Math.max(0, top),
    width: Math.min(STAGE_W, right) - Math.max(0, left),
    height: Math.min(STAGE_H, bottom) - Math.max(0, top),
  };
  const span = Math.max(right - left, bottom - top);
  const margin = MARGIN_SHARE * span;
  const near = {
    left: left - margin,
    right: right + margin,
    top: top - margin,
    bottom: bottom + margin,
  };
  const ring = RING_SHARE * span;
  const far = {
    left: Math.max(0, left - ring),
    right: Math.min(STAGE_W, right + ring),
    top: Math.max(0, top - ring),
    bottom: Math.min(STAGE_H, bottom + ring),
  };
  const outside: { where: string; rect: Rect }[] = [
    {
      where: "left of the load",
      rect: { x: far.left, y: far.top, width: near.left - far.left, height: far.bottom - far.top },
    },
    {
      where: "right of the load",
      rect: { x: near.right, y: far.top, width: far.right - near.right, height: far.bottom - far.top },
    },
    {
      where: "above the load",
      rect: { x: near.left, y: far.top, width: near.right - near.left, height: near.top - far.top },
    },
    {
      where: "below the load",
      rect: { x: near.left, y: near.bottom, width: near.right - near.left, height: far.bottom - near.bottom },
    },
  ];
  assertEqual(
    outside.filter(({ rect }) => rect.width >= 1 && rect.height >= 1).length,
    4,
    "the four bands of yard around the load's projected box, which this " +
      "point needs the box to stand clear of the stage's edges for",
  );

  // Where the canvas sits on the page, so a logical rectangle names a real one.
  const fit = (await h.page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (canvas === null) return null;
    const at = canvas.getBoundingClientRect();
    return { x: at.x, y: at.y, width: at.width, height: at.height };
  })) as Rect | null;
  assertTrue(fit !== null, "a <canvas> on the page for the build to draw in");

  const shot = async (rect: Rect): Promise<Buffer> => {
    const sx = fit!.width / STAGE_W;
    const sy = fit!.height / STAGE_H;
    return h.page.screenshot({
      clip: {
        x: fit!.x + rect.x * sx,
        y: fit!.y + rect.y * sy,
        width: Math.max(1, rect.width * sx),
        height: Math.max(1, rect.height * sy),
      },
    });
  };

  const before = {
    inside: await shot(inside),
    outside: await Promise.all(outside.map(({ rect }) => shot(rect))),
  };

  await h.debug.addLoad(CLASS, MASS, START.x, START.y, START.z, START.yaw);
  await h.advance(1);
  const posed = await h.snapshot();
  assertEqual(
    posed.site.loads.length,
    1,
    "the loads standing in the yard once one is posed",
  );
  assertEqual(
    posed.site.loads[0]?.from.x,
    START.x,
    "the starting pose the posed load holds",
  );

  assertTrue(
    !before.inside.equals(await shot(inside)),
    "the picture inside the load's projected class box to change when a " +
      `waiting ${CLASS} is posed with its lift point at (${START.x}, ` +
      `${START.y}, ${START.z}), since the game draws each load at its pose ` +
      "(specs/assets.md)",
  );

  const spilled: string[] = [];
  for (const [index, band] of outside.entries()) {
    if (!before.outside[index]!.equals(await shot(band.rect))) {
      spilled.push(band.where);
    }
  }
  assertEqual(
    spilled.join(", "),
    "",
    `the yard from ${margin.toFixed(1)} to ${ring.toFixed(1)} logical pixels ` +
      "around the load's projected class box, which posing a waiting load may " +
      "not change: the load is drawn at its starting pose and not beside it " +
      "(specs/assets.md, specs/world.md)",
  );

  await h.capture("waiting", "The waiting load at its starting pose");
});
